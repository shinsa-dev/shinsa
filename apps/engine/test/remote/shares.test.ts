import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type Evidence,
  PUBLICATION_LIMITS,
  type PublicationRequest,
  REMOTE_PATHS,
  resolveMachineFilePath,
  resolveMachinePublicationPath,
  resolveMachinePublicationRemovePath,
  resolveSharePreviewApiPath,
  resolveSharePreviewCodeApiPath,
  resolveSharePreviewDiffApiPath,
  SHARE_CODE_FILE,
  SHARE_DIFF_FILE,
  type ShinsaState,
  type Task,
} from '@shinsa/core';
import { ControlClient } from '../../src/remote/control.ts';
import { Remote } from '../../src/remote/index.ts';
import {
  createSharePreviewRoutes,
  SHARE_LINK_LOST,
  SHARE_NOT_PAIRED,
  type ShareGitHub,
  SharePublisher,
} from '../../src/remote/shares.ts';
import { EffectError } from '../../src/runtime/failures.ts';
import { EvidenceStore } from '../../src/store/evidence.ts';
import { createTempDir } from '../helpers/index.ts';
import { createRepo, createStubEngine, createTask } from '../helpers/state.ts';
import { type FakeControlPlane, startFakeControlPlane } from './control-plane.ts';

const CREDENTIALS = {
  instanceId: 'inst1',
  machineToken: 'machine-token',
  tunnelToken: 'tunnel',
  tunnelHost: 't-inst1.shinsa.dev',
  connectKey: 'key',
};

const CONTEXT = { key: 'share.publish:task-1:1', attempt: 1, signal: new AbortController().signal };

const SHARE_URL = 'https://app.shinsa.dev/share/abc';

let running: FakeControlPlane | null = null;

afterEach(async () => {
  await running?.stop();
  running = null;
});

interface FakeGitHub extends ShareGitHub {
  diffReads: number;
  fileReads: string[];
}

const DIFF = 'diff --git a/src/a.ts b/src/a.ts';

const CODE = JSON.stringify({ files: { 'src/a.ts': 'content of src/a.ts at abc123' } });

function createGitHub(diff = DIFF, readFile?: ShareGitHub['readFile']): FakeGitHub {
  const github: FakeGitHub = {
    diffReads: 0,
    fileReads: [],
    readDiff: () => {
      github.diffReads += 1;
      return Promise.resolve(diff);
    },
    readFile: (repo, ref, path) => {
      github.fileReads.push(`${path}@${ref}`);
      return readFile ? readFile(repo, ref, path) : Promise.resolve(`content of ${path} at ${ref}`);
    },
  };
  return github;
}

function createEvidence(overrides: Partial<Evidence>): Evidence {
  return {
    id: 'shot-1',
    taskId: 'task-1',
    runId: 'run-1',
    kind: 'screenshot',
    title: 'Settings',
    uri: '/api/evidence/settings.png',
    attachedAt: 1,
    round: 1,
    ...overrides,
  };
}

function shareTask(overrides: Partial<Task> = {}) {
  return createTask({
    repoId: 'repo-1',
    activity: [],
    share: { at: 1, url: null },
    pullRequest: {
      number: 7,
      url: 'https://github.com/acme/app/pull/7',
      state: 'open',
      checks: 'passing',
      unresolvedComments: 0,
      mergeable: true,
      headSha: 'abc123',
      updatedAt: 1,
    },
    ...overrides,
  });
}

interface SetUp {
  paired?: boolean;
  github?: FakeGitHub;
  patch?: (state: ShinsaState) => void;
  now?: () => number;
}

function setUp(options: SetUp = {}) {
  const plane = startFakeControlPlane();
  running = plane;
  const dir = createTempDir();
  const path = join(dir, 'remote.json');
  if (options.paired ?? true)
    writeFileSync(path, JSON.stringify({ credentials: CREDENTIALS, enabled: true, owner: 'mona' }));
  const remote = new Remote({
    path,
    control: new ControlClient({ origin: plane.origin }),
    connect: () => Promise.reject(new Error('no tunnel in this test')),
    localUrl: () => 'http://127.0.0.1:1',
    version: '1',
    maxBodyBytes: 1024,
    machineName: 'Studio',
    openUrl: () => Promise.resolve(),
  });
  const evidenceDir = join(dir, 'evidence');
  mkdirSync(evidenceDir);
  writeFileSync(join(evidenceDir, 'settings.png'), 'png bytes');
  writeFileSync(join(evidenceDir, 'page.html'), '<script>');
  const stub = createStubEngine((state) => {
    state.repos['repo-1'] = createRepo();
    state.tasks['task-1'] = shareTask();
    state.evidence['shot-1'] = createEvidence({});
    options.patch?.(state);
  });
  const github = options.github ?? createGitHub();
  const publisher = new SharePublisher({
    engine: stub.engine,
    remote,
    evidence: new EvidenceStore(evidenceDir),
    github,
    ...(options.now ? { now: options.now } : {}),
  });
  plane.answers.set(REMOTE_PATHS.machineFilesCheck, () =>
    Response.json({ missing: (lastBody(REMOTE_PATHS.machineFilesCheck) as { hashes: string[] }).hashes })
  );
  plane.answers.set(resolveMachinePublicationPath('task-1'), () => Response.json({ url: SHARE_URL }));
  return { plane, stub, publisher, github, remote };
}

function lastBody(path: string) {
  return running?.calls.filter((call) => call.path === path).at(-1)?.body;
}

function publication() {
  return lastBody(resolveMachinePublicationPath('task-1')) as PublicationRequest;
}

function sha256(text: string) {
  return new Bun.CryptoHasher('sha256').update(text).digest('hex');
}

describe('publishing a shared task', () => {
  test('a public task goes out with its owner, machine, evidence and the pull request’s diff', async () => {
    const { plane, stub, publisher } = setUp();
    await publisher.publish('task-1', CONTEXT);
    const sent = publication();
    expect(sent.newLink).toBe(true);
    expect(sent.shared).toMatchObject({
      owner: 'mona',
      machine: 'Studio',
      repository: 'acme/app',
      code: true,
    });
    expect(sent.shared.evidence.map((item) => item.uri)).toEqual(['shared-evidence:shot-1']);
    expect(sent.files).toEqual([
      { id: 'shot-1', hash: sha256('png bytes') },
      { id: SHARE_DIFF_FILE, hash: sha256(DIFF) },
      { id: SHARE_CODE_FILE, hash: sha256(CODE) },
    ]);
    expect(plane.calls.map((call) => [call.path, call.token])).toEqual([
      [REMOTE_PATHS.machineFilesCheck, 'machine-token'],
      [resolveMachineFilePath(sha256('png bytes')), 'machine-token'],
      [resolveMachineFilePath(sha256(DIFF)), 'machine-token'],
      [resolveMachineFilePath(sha256(CODE)), 'machine-token'],
      [resolveMachinePublicationPath('task-1'), 'machine-token'],
    ]);
    expect(lastBody(resolveMachineFilePath(sha256('png bytes')))).toEqual({
      contentType: 'image/png',
      text: 'png bytes',
    });
    expect(stub.dispatched).toEqual([{ type: 'share.record', taskId: 'task-1', url: SHARE_URL }]);
    expect(stub.commandIds).toEqual([`${CONTEXT.key}:share.record`]);
  });

  test('a later publication keeps the link, uploads nothing the cloud has and reads GitHub only when it changed', async () => {
    const { plane, stub, publisher, github } = setUp();
    await publisher.publish('task-1', CONTEXT);
    const task = stub.state.tasks['task-1'] as Task;
    stub.state.tasks['task-1'] = { ...task, share: { at: 1, url: SHARE_URL } };
    plane.answers.set(REMOTE_PATHS.machineFilesCheck, () => Response.json({ missing: [] }));
    plane.answers.set(resolveMachinePublicationPath('task-1'), () => Response.json({ url: null }));
    const before = plane.calls.length;
    await publisher.publish('task-1', CONTEXT);
    expect(publication().newLink).toBe(false);
    expect(plane.calls.slice(before).map((call) => call.path)).toEqual([
      REMOTE_PATHS.machineFilesCheck,
      resolveMachinePublicationPath('task-1'),
    ]);
    expect(github.diffReads).toBe(1);
    expect(stub.dispatched.at(-1)).toEqual({ type: 'share.record', taskId: 'task-1', url: null });
    const shared = stub.state.tasks['task-1'] as Task;
    stub.state.tasks['task-1'] = {
      ...shared,
      pullRequest: shared.pullRequest ? { ...shared.pullRequest, headSha: 'def456' } : null,
    };
    await publisher.publish('task-1', CONTEXT);
    expect(github.diffReads).toBe(2);
  });

  test('a diff too large to share is left out, and not read again for the same head', async () => {
    const github = createGitHub('x'.repeat(PUBLICATION_LIMITS.fileBytes + 1));
    const { publisher } = setUp({ github });
    await publisher.publish('task-1', CONTEXT);
    expect(publication().files.map((file) => file.id)).toEqual(['shot-1']);
    expect(publication().shared.code).toBe(true);
    await publisher.publish('task-1', CONTEXT);
    expect(github.diffReads).toBe(1);
  });

  test('evidence it cannot share safely is left out, not published as a broken item', async () => {
    const { publisher } = setUp({
      patch: (state) => {
        state.evidence['page'] = createEvidence({
          id: 'page',
          uri: '/api/evidence/page.html',
          attachedAt: 2,
        });
        state.evidence['lost'] = createEvidence({ id: 'lost', uri: '/api/evidence/lost.png', attachedAt: 3 });
      },
    });
    await publisher.publish('task-1', CONTEXT);
    expect(publication().shared.evidence.map((item) => item.id)).toEqual(['shot-1']);
    expect(publication().files.map((file) => file.id)).toEqual(['shot-1', SHARE_DIFF_FILE, SHARE_CODE_FILE]);
  });

  test('the changed files go out whole from GitHub at the pushed head, without new, removed or binary ones', async () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      'diff --git a/src/new.ts b/src/new.ts',
      'new file mode 100644',
      'diff --git a/src/gone.ts b/src/gone.ts',
      'deleted file mode 100644',
      'diff --git a/logo.png b/logo.png',
      'Binary files a/logo.png and b/logo.png differ',
      'diff --git a/src/lost.ts b/src/lost.ts',
    ].join('\n');
    const github = createGitHub(diff, (_repo, ref, path) =>
      path === 'src/lost.ts' ? Promise.reject(new Error('Not Found')) : Promise.resolve(`${path}@${ref}`)
    );
    const { publisher } = setUp({ github });
    expect(JSON.parse(await publisher.previewCode('task-1'))).toEqual({
      files: { 'src/a.ts': 'src/a.ts@abc123' },
    });
    expect(github.fileReads).toEqual(['src/a.ts@abc123', 'src/lost.ts@abc123']);
  });

  test('changed files past the size a publication can carry are left out', async () => {
    const big = 'x'.repeat(PUBLICATION_LIMITS.fileBytes);
    const diff = ['diff --git a/a.ts b/a.ts', 'diff --git a/b.ts b/b.ts'].join('\n');
    const github = createGitHub(diff, (_repo, _ref, path) => Promise.resolve(path === 'a.ts' ? 'a' : big));
    const { publisher } = setUp({ github });
    expect(JSON.parse(await publisher.previewCode('task-1'))).toEqual({ files: { 'a.ts': 'a' } });
  });

  test('a pull request with no pushed head shares its diff and no whole files', async () => {
    const { publisher, github } = setUp({
      patch: (state) => {
        const task = shareTask();
        state.tasks['task-1'] = {
          ...task,
          pullRequest: task.pullRequest && { ...task.pullRequest, headSha: null },
        };
      },
    });
    await publisher.publish('task-1', CONTEXT);
    expect(publication().files.map((file) => file.id)).toEqual(['shot-1', SHARE_DIFF_FILE]);
    expect(Object.keys(publisher.preview('task-1').files)).toEqual(['shot-1', SHARE_DIFF_FILE]);
    expect(github.fileReads).toEqual([]);
  });

  test('a task with no repository and no files is published without checking any or reading a diff', async () => {
    const { plane, publisher } = setUp({
      patch: (state) => {
        state.tasks['task-1'] = shareTask({ repoId: null, pullRequest: null });
        state.evidence = {};
      },
    });
    await publisher.publish('task-1', CONTEXT);
    expect(plane.calls.map((call) => call.path)).toEqual([resolveMachinePublicationPath('task-1')]);
    expect(publication().shared).toMatchObject({ repository: null, code: false });
  });

  test('a task that is no longer shared, or is gone, is not published', async () => {
    const { plane, publisher } = setUp({
      patch: (state) => {
        state.tasks['task-1'] = shareTask({ share: null });
      },
    });
    await publisher.publish('task-1', CONTEXT);
    await publisher.publish('missing', CONTEXT);
    expect(plane.calls).toEqual([]);
  });
});

describe('when publishing cannot work', () => {
  test('a machine that is not paired fails for good, saying how to turn remote access on', async () => {
    const { plane, publisher } = setUp({ paired: false });
    const failure = await publisher.publish('task-1', CONTEXT).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(EffectError);
    expect((failure as EffectError).message).toBe(SHARE_NOT_PAIRED);
    expect((failure as EffectError).policy.retryable).toBe(false);
    await publisher.remove('task-1');
    expect(plane.calls).toEqual([]);
  });

  test('a revoked machine or a refusal fails for good, and a cloud outage is retried', async () => {
    const { plane, publisher } = setUp();
    const path = resolveMachinePublicationPath('task-1');
    plane.answers.set(path, () => new Response('', { status: 401 }));
    const revoked = (await publisher
      .publish('task-1', CONTEXT)
      .catch((error: unknown) => error)) as EffectError;
    expect(revoked.message).toBe(SHARE_NOT_PAIRED);
    plane.answers.set(path, () => new Response('', { status: 409 }));
    const refused = (await publisher
      .publish('task-1', CONTEXT)
      .catch((error: unknown) => error)) as EffectError;
    expect(refused.policy.retryable).toBe(false);
    expect(refused.message).toContain('status 409');
    plane.answers.set(path, () => new Response('', { status: 503 }));
    const outage = await publisher.publish('task-1', CONTEXT).catch((error: unknown) => error);
    expect(outage).not.toBeInstanceOf(EffectError);
    expect((outage as Error).message).toContain('status 503');
  });
});

describe('when this machine loses its pairing', () => {
  test('every link it shared is marked as no longer working, so Share again makes a new one', async () => {
    const { stub, remote } = setUp({
      patch: (state) => {
        state.tasks['task-1'] = shareTask({ share: { at: 1, url: SHARE_URL } });
        state.tasks['task-2'] = shareTask({ id: 'task-2', share: { at: 1, url: null } });
        state.tasks['task-3'] = shareTask({
          id: 'task-3',
          share: { at: 1, url: SHARE_URL, failure: 'Earlier.' },
        });
        state.tasks['task-4'] = shareTask({ id: 'task-4', share: null });
      },
    });
    await remote.disable();
    expect(stub.dispatched).toEqual([]);
    await remote.remove();
    expect(stub.dispatched).toEqual([{ type: 'share.fail', taskId: 'task-1', detail: SHARE_LINK_LOST }]);
  });

  test('a failure to record a lost link is logged, never thrown', async () => {
    const { stub, remote } = setUp({
      patch: (state) => {
        state.tasks['task-1'] = shareTask({ share: { at: 1, url: SHARE_URL } });
      },
    });
    stub.reject(() => true, new Error('closed'));
    await remote.remove();
    expect(stub.dispatched).toHaveLength(1);
  });
});

describe('removing a publication', () => {
  test('tells app.shinsa.dev with the machine token, and reads a refusal the same way', async () => {
    const { plane, publisher } = setUp();
    await publisher.remove('task-1');
    expect(plane.calls).toEqual([
      { path: resolveMachinePublicationRemovePath('task-1'), token: 'machine-token', body: {} },
    ]);
    plane.answers.set(resolveMachinePublicationRemovePath('task-1'), () => new Response('', { status: 401 }));
    const failure = (await publisher.remove('task-1').catch((error: unknown) => error)) as EffectError;
    expect(failure.message).toBe(SHARE_NOT_PAIRED);
  });
});

describe('previewing a share', () => {
  test('shows what a viewer would see from local addresses, before the task is shared and with nothing sent', async () => {
    const { plane, publisher } = setUp({
      paired: false,
      patch: (state) => {
        state.tasks['task-1'] = shareTask({ share: null });
        state.evidence['page'] = createEvidence({
          id: 'page',
          uri: '/api/evidence/page.html',
          attachedAt: 2,
        });
      },
    });
    const preview = publisher.preview('task-1');
    expect(preview.files).toEqual({
      'shot-1': '/api/evidence/settings.png',
      [SHARE_DIFF_FILE]: resolveSharePreviewDiffApiPath('task-1'),
      [SHARE_CODE_FILE]: resolveSharePreviewCodeApiPath('task-1'),
    });
    expect(preview.shared.evidence.map((item) => item.id)).toEqual(['shot-1']);
    expect(preview.shared).toMatchObject({ owner: null, machine: 'Studio', code: true });
    expect(await publisher.previewDiff('task-1')).toBe('diff --git a/src/a.ts b/src/a.ts');
    expect(plane.calls).toEqual([]);
  });

  test('a task without a pull request previews with no code, and its diff is refused', async () => {
    const { publisher, github } = setUp({
      patch: (state) => {
        state.tasks['task-1'] = shareTask({ pullRequest: null });
      },
    });
    const preview = publisher.preview('task-1');
    expect(preview.files).toEqual({ 'shot-1': '/api/evidence/settings.png' });
    expect(preview.shared.code).toBe(false);
    await expect(publisher.previewDiff('task-1')).rejects.toThrow('This task shares no code.');
    expect(github.diffReads).toBe(0);
  });

  test('an unknown task cannot be previewed', async () => {
    const { publisher } = setUp();
    expect(() => publisher.preview('missing')).toThrow('No such task.');
  });

  test('the routes answer the preview as JSON and the diff and the files as plain text', async () => {
    const { publisher } = setUp();
    const [preview, diff, code] = createSharePreviewRoutes(publisher);
    const previewMatch = preview?.pattern.exec(resolveSharePreviewApiPath('task-1'));
    if (!preview || !previewMatch || !diff) throw new Error('The preview routes do not match their paths.');
    const answer = await preview.respond(previewMatch, new Request('http://x'));
    expect(((await answer.json()) as { shared: { code: boolean } }).shared.code).toBe(true);
    const diffMatch = diff.pattern.exec(resolveSharePreviewDiffApiPath('task-1'));
    if (!diffMatch) throw new Error('The diff route does not match its path.');
    const text = await diff.respond(diffMatch, new Request('http://x'));
    expect(text?.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await text?.text()).toBe(DIFF);
    const codeMatch = code?.pattern.exec(resolveSharePreviewCodeApiPath('task-1'));
    if (!code || !codeMatch) throw new Error('The code route does not match its path.');
    expect(await (await code.respond(codeMatch, new Request('http://x'))).text()).toBe(CODE);
  });
});
