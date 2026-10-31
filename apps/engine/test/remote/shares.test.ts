import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type Evidence,
  PUBLICATION_LIMITS,
  type PublicationRequest,
  REMOTE_PATHS,
  type RepositoryVisibility,
  resolveMachineFilePath,
  resolveMachinePublicationPath,
  resolveMachinePublicationRemovePath,
  SHARE_DIFF_FILE,
  type ShinsaState,
  type Task,
} from '@shinsa/core';
import { ControlClient } from '../../src/remote/control.ts';
import { Remote } from '../../src/remote/index.ts';
import {
  SHARE_NOT_PAIRED,
  type ShareGitHub,
  SharePublisher,
  VISIBILITY_TTL_MS,
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
  visibilityReads: number;
  diffReads: number;
}

function createGitHub(
  visibility: RepositoryVisibility,
  diff = 'diff --git a/src/a.ts b/src/a.ts'
): FakeGitHub {
  const github: FakeGitHub = {
    visibilityReads: 0,
    diffReads: 0,
    resolveVisibility: () => {
      github.visibilityReads += 1;
      return Promise.resolve(visibility);
    },
    readDiff: () => {
      github.diffReads += 1;
      return Promise.resolve(diff);
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
  const github = options.github ?? createGitHub('public');
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
  return { plane, stub, publisher, github };
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
      { id: SHARE_DIFF_FILE, hash: sha256('diff --git a/src/a.ts b/src/a.ts') },
    ]);
    expect(plane.calls.map((call) => [call.path, call.token])).toEqual([
      [REMOTE_PATHS.machineFilesCheck, 'machine-token'],
      [resolveMachineFilePath(sha256('png bytes')), 'machine-token'],
      [resolveMachineFilePath(sha256('diff --git a/src/a.ts b/src/a.ts')), 'machine-token'],
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
    expect(github).toMatchObject({ visibilityReads: 1, diffReads: 1 });
    expect(stub.dispatched.at(-1)).toEqual({ type: 'share.record', taskId: 'task-1', url: null });
    const shared = stub.state.tasks['task-1'] as Task;
    stub.state.tasks['task-1'] = {
      ...shared,
      pullRequest: shared.pullRequest ? { ...shared.pullRequest, headSha: 'def456' } : null,
    };
    await publisher.publish('task-1', CONTEXT);
    expect(github.diffReads).toBe(2);
  });

  test('a private repository, or one whose visibility is unknown, sends no diff and never reads one', async () => {
    for (const visibility of ['private', 'unknown'] as const) {
      const github = createGitHub(visibility);
      const { publisher } = setUp({ github });
      await publisher.publish('task-1', CONTEXT);
      expect(publication().shared).toMatchObject({ code: false, repository: null });
      expect(publication().files.map((file) => file.id)).toEqual(['shot-1']);
      expect(github.diffReads).toBe(0);
      await running?.stop();
    }
  });

  test('a diff too large to share is left out, and not read again for the same head', async () => {
    const github = createGitHub('public', 'x'.repeat(PUBLICATION_LIMITS.fileBytes + 1));
    const { publisher } = setUp({ github });
    await publisher.publish('task-1', CONTEXT);
    expect(publication().files.map((file) => file.id)).toEqual(['shot-1']);
    expect(publication().shared.code).toBe(true);
    await publisher.publish('task-1', CONTEXT);
    expect(github.diffReads).toBe(1);
  });

  test('reads the repository’s visibility again once the cached answer is old', async () => {
    let now = 1_000;
    const github = createGitHub('public');
    const { publisher } = setUp({ github, now: () => now });
    await publisher.publish('task-1', CONTEXT);
    await publisher.publish('task-1', CONTEXT);
    expect(github.visibilityReads).toBe(1);
    now += VISIBILITY_TTL_MS;
    await publisher.publish('task-1', CONTEXT);
    expect(github.visibilityReads).toBe(2);
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
    expect(publication().files.map((file) => file.id)).toEqual(['shot-1', SHARE_DIFF_FILE]);
  });

  test('a task with no repository and no files is published without checking any', async () => {
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
