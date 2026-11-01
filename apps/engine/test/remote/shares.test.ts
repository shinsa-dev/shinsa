import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type Bytes,
  CHAT_PROTOCOL_VERSION,
  type ChatEntry,
  type ChatEvent,
  createFrameOpener,
  createShareHello,
  decodeText,
  deriveShareSessionKey,
  type Evidence,
  parseBodyChunk,
  parseShareMessage,
  parseShareUrl,
  parseShareWelcome,
  REMOTE_KEY_ALGORITHM,
  SHARE_CODE_FILE,
  SHARE_DIFF_FILE,
  SHARE_FILE_BYTES,
  SHARE_TRANSCRIPT_PAGE,
  type ShareLiveView,
  type ShareMessage,
  type SharePreset,
  type ShinsaState,
  serializeBase64Url,
  serializeShareUrl,
  type Task,
} from '@shinsa/core';
import { ControlClient } from '../../src/remote/control.ts';
import { Remote } from '../../src/remote/index.ts';
import { SHARE_GONE_REASON } from '../../src/remote/share-channel.ts';
import {
  SHARE_LINK_LOST,
  SHARE_NOT_PAIRED,
  SHARE_REMOTE_CHANGED,
  type ShareGitHub,
  Shares,
  type ShareTranscripts,
} from '../../src/remote/shares.ts';
import { EffectError } from '../../src/runtime/failures.ts';
import { EvidenceStore } from '../../src/store/evidence.ts';
import { createTempDir, until } from '../helpers/index.ts';
import { createRepo, createRun, createStubEngine, createTask } from '../helpers/state.ts';
import { type FakeControlPlane, startFakeControlPlane } from './control-plane.ts';

const CREDENTIALS = {
  instanceId: 'inst1',
  machineToken: 'machine-token',
  tunnelToken: 'tunnel',
  tunnelHost: 't-inst1.shinsa.dev',
  connectKey: 'key',
};

const CONTEXT = { key: 'share.link:task-1:1', attempt: 1, signal: new AbortController().signal };

const SHARE_ID = 'BwcHBwcHBwcHBwcHBwcHBw';

const SHARE_KEY = 'CQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQk';

const SHARE_URL = serializeShareUrl('https://app.shinsa.dev', {
  instanceId: 'inst1',
  shareId: SHARE_ID,
  key: SHARE_KEY,
});

const SHARING = { at: 1, limit: 'none', preset: 'full', endsAt: null } as const;

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

interface FakeTranscripts extends ShareTranscripts {
  runs: Map<string, ChatEntry[]>;
  record: (runId: string, event: ChatEvent) => void;
}

function createTranscripts(): FakeTranscripts {
  const listeners = new Set<(runId: string) => void>();
  const transcripts: FakeTranscripts = {
    runs: new Map(),
    listEntries: (runId) => [...(transcripts.runs.get(runId) ?? [])],
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    record: (runId, event) => {
      const entries = transcripts.runs.get(runId) ?? [];
      entries.push({ ...event, v: CHAT_PROTOCOL_VERSION, id: `e${entries.length}`, at: 1 } as ChatEntry);
      transcripts.runs.set(runId, entries);
      for (const listener of listeners) listener(runId);
    },
  };
  return transcripts;
}

function shareTask(overrides: Partial<Task> = {}) {
  return createTask({
    repoId: 'repo-1',
    activity: [],
    share: { ...SHARING, url: null },
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
  transcripts?: FakeTranscripts;
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
  const transcripts = options.transcripts ?? createTranscripts();
  let fill = 7;
  const publisher = new Shares({
    engine: stub.engine,
    remote,
    evidence: new EvidenceStore(evidenceDir),
    transcripts,
    github,
    random: (bytes) => new Uint8Array(bytes).fill(fill++),
    ...(options.now ? { now: options.now } : {}),
  });
  return { plane, stub, publisher, github, remote, transcripts };
}

function sha256(text: string) {
  return new Bun.CryptoHasher('sha256').update(text).digest('hex');
}

interface Viewer {
  messages: ShareMessage[];
  closed: { code: number; reason: string } | null;
  refused: string | null;
  views: () => ShareLiveView[];
  files: () => Record<string, string>;
  send: (data: string) => Promise<void>;
}

async function openViewer(publisher: Shares, url = SHARE_URL, shareId = SHARE_ID): Promise<Viewer> {
  const link = parseShareUrl(url);
  if (!link) throw new Error('not a share link');
  const ephemeral = (await crypto.subtle.generateKey(REMOTE_KEY_ALGORITHM, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const hello = await createShareHello(link.shareId, link.key, ephemeral.publicKey);
  let open: ((frame: Bytes) => Promise<Bytes>) | null = null;
  let queue: Promise<void> = Promise.resolve();
  const viewer: Viewer = {
    messages: [],
    closed: null,
    refused: null,
    views: () =>
      viewer.messages.flatMap((message) =>
        message.t === 'view' ? [JSON.parse(message.data) as ShareLiveView] : []
      ),
    files: () => {
      const files: Record<string, string> = {};
      for (const message of viewer.messages) {
        if (message.t === 'file') files[message.id] = '';
        if (message.t === 'body') files[message.id] += decodeText(parseBodyChunk(message.chunk) as Bytes);
      }
      return files;
    },
    send: (data) => channel.receive(data),
  };
  const channel = publisher.openChannel(
    {
      send: (data) => {
        queue = queue.then(async () => {
          if (typeof data === 'string') {
            const welcome = parseShareWelcome(data);
            if (welcome?.type === 'refused') viewer.refused = welcome.reason;
            if (welcome?.type !== 'welcome') return;
            const key = await deriveShareSessionKey(
              link.key,
              { share: link.shareId, clientEphemeral: hello.ephemeral, serverEphemeral: welcome.ephemeral },
              ephemeral.privateKey,
              welcome.ephemeral
            );
            open = createFrameOpener(key);
            return;
          }
          if (!open) throw new Error('a frame before the welcome');
          const message = parseShareMessage(decodeText(await open(data as Bytes)));
          if (message) viewer.messages.push(message);
        });
      },
      close: (code, reason) => {
        viewer.closed = { code, reason };
      },
    },
    shareId
  );
  await channel.receive(JSON.stringify(hello));
  await queue;
  return viewer;
}

function sharedSetUp(options: SetUp & { preset?: SharePreset } = {}) {
  return setUp({
    ...options,
    patch: (state) => {
      state.tasks['task-1'] = shareTask({
        share: { ...SHARING, preset: options.preset ?? 'full', url: SHARE_URL },
      });
      state.runs['run-1'] = createRun();
      options.patch?.(state);
    },
  });
}

describe('making a share link', () => {
  test('a new share gets a link to this machine with a fresh id and a key only in its fragment', async () => {
    const { stub, publisher, remote } = setUp();
    await publisher.link('task-1', CONTEXT);
    const recorded = stub.dispatched[0] as { url: string };
    const key = serializeBase64Url(new Uint8Array(32).fill(8));
    expect(recorded.url).toBe(
      serializeShareUrl(remote.appOrigin, { instanceId: 'inst1', shareId: SHARE_ID, key })
    );
    expect(parseShareUrl(recorded.url)?.shareId).toBe(SHARE_ID);
    expect(stub.commandIds).toEqual([`${CONTEXT.key}:share.record`]);
  });

  test('a link to this machine is kept, and one to an earlier pairing is replaced', async () => {
    const { stub, publisher } = sharedSetUp();
    await publisher.link('task-1', CONTEXT);
    expect(stub.dispatched).toEqual([{ type: 'share.record', taskId: 'task-1', url: null }]);
    stub.state.tasks['task-1'] = shareTask({
      share: {
        ...SHARING,
        url: serializeShareUrl('https://app.shinsa.dev', {
          instanceId: 'old',
          shareId: SHARE_ID,
          key: SHARE_KEY,
        }),
      },
    });
    await publisher.link('task-1', CONTEXT);
    expect(parseShareUrl((stub.dispatched[1] as { url: string }).url)?.instanceId).toBe('inst1');
  });

  test('a key and an id come from the system random source by default', async () => {
    const { stub, remote } = setUp();
    const shares = new Shares({
      engine: stub.engine,
      remote,
      evidence: new EvidenceStore(createTempDir()),
      transcripts: createTranscripts(),
    });
    await shares.link('task-1', CONTEXT);
    const link = parseShareUrl((stub.dispatched[0] as { url: string }).url);
    expect(link?.key).toHaveLength(43);
    expect(link?.shareId).not.toBe(SHARE_ID);
  });

  test('a machine that is not paired fails for good, saying how to turn remote access on', async () => {
    const { publisher } = setUp({ paired: false });
    const failure = await publisher.link('task-1', CONTEXT).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(EffectError);
    expect((failure as EffectError).message).toBe(SHARE_NOT_PAIRED);
    expect((failure as EffectError).policy.retryable).toBe(false);
  });

  test('a task that is no longer shared gets no link', async () => {
    const { stub, publisher } = setUp({
      patch: (state) => {
        state.tasks['task-1'] = shareTask({ share: null });
      },
    });
    await publisher.link('task-1', CONTEXT);
    await publisher.link('missing', CONTEXT);
    expect(stub.dispatched).toEqual([]);
  });
});

describe('a share link opened live', () => {
  test('streams the task and its files, sealed with the key in the link, and nothing goes to app.shinsa.dev', async () => {
    const { plane, publisher } = sharedSetUp();
    expect(publisher.acceptsShare(SHARE_ID)).toBe(true);
    expect(publisher.acceptsShare('other')).toBe(false);
    const viewer = await openViewer(publisher);
    await until('the viewer reads it', () =>
      viewer.messages.some((message) => message.t === 'end' && message.id === SHARE_CODE_FILE)
    );
    const [view] = viewer.views();
    expect(view?.shared).toMatchObject({
      owner: 'mona',
      machine: 'Studio',
      repository: 'acme/app',
      code: true,
    });
    expect(view?.files).toEqual({
      'shot-1': { version: sha256('png bytes'), type: 'image/png' },
      [SHARE_DIFF_FILE]: { version: '7:abc123', type: 'text/plain' },
      [SHARE_CODE_FILE]: { version: '7:abc123', type: 'text/plain' },
    });
    expect(viewer.files()).toEqual({
      'shot-1': 'png bytes',
      [SHARE_DIFF_FILE]: DIFF,
      [SHARE_CODE_FILE]: CODE,
    });
    expect(plane.calls).toEqual([]);
  });

  test('pushes a change at once, sends a file again only when it changed, and reads GitHub once per head', async () => {
    const { stub, publisher, github } = sharedSetUp();
    const viewer = await openViewer(publisher);
    await until('the viewer reads it', () =>
      viewer.messages.some((message) => message.t === 'end' && message.id === SHARE_CODE_FILE)
    );
    const sent = viewer.messages.length;
    stub.notify();
    await Bun.sleep(0);
    expect(viewer.messages.length).toBe(sent);
    stub.state.tasks['task-1'] = shareTask({ title: 'Renamed', share: { ...SHARING, url: SHARE_URL } });
    stub.notify();
    await until('the viewer reads it', () => viewer.views().length === 2);
    expect(viewer.views()[1]?.shared.task.title).toBe('Renamed');
    expect(viewer.messages.slice(sent).filter((message) => message.t === 'file')).toEqual([]);
    expect(github.diffReads).toBe(1);
  });

  test('ends when you stop sharing, and refuses a link whose key is wrong', async () => {
    const { stub, publisher } = sharedSetUp();
    const viewer = await openViewer(publisher);
    stub.state.tasks['task-1'] = shareTask({ share: null });
    stub.notify();
    await until('the viewer reads it', () => viewer.closed !== null);
    expect(viewer.messages.at(-1)).toEqual({ t: 'closed', reason: SHARE_GONE_REASON });
    expect(viewer.closed).toEqual({ code: 1000, reason: SHARE_GONE_REASON });
    const stopped = await openViewer(publisher);
    expect(stopped.refused).toBe(SHARE_GONE_REASON);
    expect(publisher.acceptsShare(SHARE_ID)).toBe(true);
    stub.state.tasks['task-1'] = shareTask({ share: { ...SHARING, url: SHARE_URL } });
    const wrong = await openViewer(publisher, SHARE_URL.replace(/#.*/, `#${'A'.repeat(43)}`));
    expect(wrong.refused).toBe(SHARE_GONE_REASON);
    expect(wrong.closed?.code).toBe(1008);
  });

  test('refuses a link whose time ran out, even before the clock ends the share', async () => {
    const { stub, publisher } = sharedSetUp();
    stub.state.tasks['task-1'] = shareTask({
      share: { ...SHARING, limit: 'hour', preset: 'full', endsAt: 0, url: SHARE_URL },
    });
    const expired = await openViewer(publisher);
    expect(expired.refused).toBe(SHARE_GONE_REASON);
  });

  test('takes nothing from the viewer: any message after the hello closes it', async () => {
    const { publisher } = sharedSetUp();
    const viewer = await openViewer(publisher);
    await viewer.send(JSON.stringify({ type: 'task.prioritize', taskId: 'task-1', priority: 'urgent' }));
    expect(viewer.closed).toEqual({ code: 1008, reason: 'A share link only listens.' });
    const mismatched = await openViewer(publisher, SHARE_URL, 'other');
    expect(mismatched.closed?.reason).toBe('The share link expects a hello first.');
  });

  test('ends every open link when remote access is turned off', async () => {
    const { publisher, remote } = sharedSetUp();
    const viewer = await openViewer(publisher);
    await remote.disable();
    await until('the viewer reads it', () => viewer.closed !== null);
    expect(viewer.closed?.reason).toBe(SHARE_REMOTE_CHANGED);
    expect(publisher.acceptsShare(SHARE_ID)).toBe(false);
  });

  test('a file too large to stream is left out, and the evidence it shows with it', async () => {
    const github = createGitHub('x'.repeat(SHARE_FILE_BYTES + 1));
    const { publisher } = sharedSetUp({
      github,
      patch: (state) => {
        state.evidence.page = createEvidence({
          id: 'page',
          uri: '/api/evidence/page.html',
          attachedAt: 2,
        });
        state.evidence.lost = createEvidence({ id: 'lost', uri: '/api/evidence/lost.png', attachedAt: 3 });
      },
    });
    const live = await publisher.resolveLive('task-1');
    expect(Object.keys(live.view.files)).toEqual(['shot-1']);
    expect(live.view.shared.evidence.map((item) => item.id)).toEqual(['shot-1']);
  });

  test('a pull request GitHub cannot read leaves the code out, keeps the link open and is read again on the next change', async () => {
    const github = createGitHub();
    let down = true;
    const readDiff = github.readDiff;
    github.readDiff = (repo, number) => {
      if (!down) return readDiff(repo, number);
      github.diffReads += 1;
      return Promise.reject(new Error('gh: not logged in'));
    };
    const { stub, publisher } = sharedSetUp({ github });
    const viewer = await openViewer(publisher);
    await until('the viewer reads it', () => viewer.views().length === 1);
    expect(Object.keys(viewer.views()[0]?.files ?? {})).toEqual(['shot-1']);
    expect(viewer.closed).toBeNull();
    down = false;
    stub.notify();
    await until('the viewer reads the code', () =>
      viewer.messages.some((message) => message.t === 'end' && message.id === SHARE_CODE_FILE)
    );
    expect(github.diffReads).toBe(2);
    expect(viewer.closed).toBeNull();
  });

  test('a closed channel is forgotten', async () => {
    const { stub, publisher } = sharedSetUp();
    const viewer = await openViewer(publisher);
    const channel = publisher.openChannel({ send: () => undefined, close: () => undefined }, SHARE_ID);
    publisher.closeChannel(channel);
    stub.notify();
    expect(viewer.closed).toBeNull();
  });
});

describe('when this machine is paired again', () => {
  test('every link it shared is marked as no longer working, so Share again makes a new one', async () => {
    const { stub, remote } = setUp({
      patch: (state) => {
        state.tasks['task-1'] = shareTask({ share: { ...SHARING, url: SHARE_URL } });
        state.tasks['task-2'] = shareTask({ id: 'task-2', share: { ...SHARING, url: null } });
        state.tasks['task-3'] = shareTask({
          id: 'task-3',
          share: { ...SHARING, url: SHARE_URL, failure: 'Earlier.' },
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
        state.tasks['task-1'] = shareTask({ share: { ...SHARING, url: SHARE_URL } });
      },
    });
    stub.reject(() => true, new Error('closed'));
    await remote.remove();
    expect(stub.dispatched).toHaveLength(1);
  });
});

async function readLiveFile(publisher: Shares, id: string) {
  const file = (await publisher.resolveLive('task-1')).files.find((candidate) => candidate.id === id);
  if (!file) return null;
  return decodeText(await file.read());
}

describe('what a link shows', () => {
  test('lists the evidence a viewer can open and the code, and leaves out what it cannot send', async () => {
    const { plane, publisher } = setUp({
      paired: false,
      patch: (state) => {
        state.tasks['task-1'] = shareTask({ share: null });
        state.evidence.page = createEvidence({ id: 'page', uri: '/api/evidence/page.html', attachedAt: 2 });
      },
    });
    const { view } = await publisher.resolveLive('task-1');
    expect(Object.keys(view.files)).toEqual(['shot-1', SHARE_DIFF_FILE, SHARE_CODE_FILE]);
    expect(view.shared.evidence.map((item) => item.id)).toEqual(['shot-1']);
    expect(view.shared).toMatchObject({ owner: null, machine: 'Studio', code: true });
    expect(await readLiveFile(publisher, SHARE_DIFF_FILE)).toBe(DIFF);
    expect(plane.calls).toEqual([]);
  });

  test('a task without a pull request shows no code and reads nothing from GitHub', async () => {
    const { publisher, github } = setUp({
      patch: (state) => {
        state.tasks['task-1'] = shareTask({ pullRequest: null });
      },
    });
    const { view } = await publisher.resolveLive('task-1');
    expect(Object.keys(view.files)).toEqual(['shot-1']);
    expect(view.shared.code).toBe(false);
    expect(github.diffReads).toBe(0);
  });

  test('an unknown task shows nothing', async () => {
    const { publisher } = setUp();
    await expect(publisher.resolveLive('missing')).rejects.toThrow('No such task.');
  });

  test('the changed files come whole from GitHub at the pushed head, without new, removed or binary ones', async () => {
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
    expect(JSON.parse((await readLiveFile(publisher, SHARE_CODE_FILE)) ?? '')).toEqual({
      files: { 'src/a.ts': 'src/a.ts@abc123' },
    });
    expect(github.fileReads).toEqual(['src/a.ts@abc123', 'src/lost.ts@abc123']);
  });

  test('changed files past the size a file can carry are left out', async () => {
    const big = 'x'.repeat(SHARE_FILE_BYTES);
    const diff = ['diff --git a/a.ts b/a.ts', 'diff --git a/b.ts b/b.ts'].join('\n');
    const github = createGitHub(diff, (_repo, _ref, path) => Promise.resolve(path === 'a.ts' ? 'a' : big));
    const { publisher } = setUp({ github });
    expect(JSON.parse((await readLiveFile(publisher, SHARE_CODE_FILE)) ?? '')).toEqual({
      files: { 'a.ts': 'a' },
    });
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
    expect(Object.keys((await publisher.resolveLive('task-1')).view.files)).toEqual([
      'shot-1',
      SHARE_DIFF_FILE,
    ]);
    expect(github.fileReads).toEqual([]);
  });
});

describe('a share by preset', () => {
  test('a status share names no one, no machine and no repository, and reads no code or evidence', async () => {
    const { publisher, github } = sharedSetUp({ preset: 'status' });
    const live = await publisher.resolveLive('task-1');
    expect(live.view.shared).toMatchObject({
      preset: 'status',
      owner: null,
      machine: null,
      repository: null,
      repo: null,
      code: false,
      evidence: [],
      runs: [],
    });
    expect(live.files).toEqual([]);
    expect(github.diffReads).toBe(0);
  });

  test('a full share streams no transcript', async () => {
    const transcripts = createTranscripts();
    transcripts.record('run-1', { type: 'agent', phase: 'final', text: 'Done.' });
    const { publisher } = sharedSetUp({ transcripts });
    const live = await publisher.resolveLive('task-1');
    expect(Object.keys(live.view.files)).not.toContain('transcript-run-1-0');
    const viewer = await openViewer(publisher);
    await until('the viewer has the view', () => viewer.views().length > 0);
    const resolve = publisher.resolveLive.bind(publisher);
    let builds = 0;
    publisher.resolveLive = (taskId) => {
      builds += 1;
      return resolve(taskId);
    };
    transcripts.record('run-1', { type: 'agent', phase: 'final', text: 'Again.' });
    await Bun.sleep(0);
    expect(builds).toBe(0);
  });

  test('an everything share sends a full page of a transcript once, and only its last page as it grows', async () => {
    const transcripts = createTranscripts();
    for (let index = 0; index <= SHARE_TRANSCRIPT_PAGE; index += 1) {
      transcripts.record('run-1', { type: 'agent', phase: 'interim', text: `Step ${index}` });
    }
    const { publisher } = sharedSetUp({ preset: 'everything', transcripts });
    const viewer = await openViewer(publisher);
    await until('the viewer reads both pages', () => 'transcript-run-1-1' in viewer.files());
    transcripts.record('run-1', { type: 'agent', phase: 'final', text: 'Done.' });
    await until('the viewer reads the last page again', () =>
      viewer.messages.some(
        (message) => message.t === 'file' && message.id === 'transcript-run-1-1' && message.version === '2'
      )
    );
    const sends = viewer.messages.filter(
      (message) => message.t === 'file' && message.id === 'transcript-run-1-0'
    );
    expect(sends).toHaveLength(1);
    const last = JSON.parse(viewer.files()['transcript-run-1-1'] ?? '[]') as ChatEntry[];
    expect(last.map((entry) => (entry.type === 'agent' ? entry.text : ''))).toEqual([
      `Step ${SHARE_TRANSCRIPT_PAGE}`,
      'Done.',
    ]);
  });

  test('an everything share streams each run without your turns, and again as it grows', async () => {
    const transcripts = createTranscripts();
    transcripts.record('run-1', {
      type: 'user',
      from: 'shinsa',
      text: 'Build phase 1. sk-0000',
      attachments: [],
    });
    transcripts.record('run-1', { type: 'agent', phase: 'interim', text: 'Reading.' });
    transcripts.record('run-2', { type: 'agent', phase: 'interim', text: 'Another task.' });
    const { publisher } = sharedSetUp({ preset: 'everything', transcripts });
    const viewer = await openViewer(publisher);
    await until('the viewer reads the transcript', () => 'transcript-run-1-0' in viewer.files());
    expect(viewer.views()[0]?.files['transcript-run-1-0']).toEqual({ version: '2', type: 'text/plain' });
    const first = JSON.parse(viewer.files()['transcript-run-1-0'] ?? '[]') as ChatEntry[];
    expect(first.map((entry) => entry.type)).toEqual(['agent']);
    expect(viewer.files()['transcript-run-1-0']).not.toContain('sk-0000');
    const sent = viewer.messages.length;
    transcripts.record('run-2', { type: 'agent', phase: 'final', text: 'Not this task.' });
    transcripts.record('unknown', { type: 'agent', phase: 'final', text: 'No run.' });
    await Bun.sleep(0);
    expect(viewer.messages.length).toBe(sent);
    transcripts.record('run-1', { type: 'agent', phase: 'final', text: 'Done.' });
    await until('the viewer reads it again', () =>
      viewer.messages.some((message) => message.t === 'file' && message.version === '3')
    );
    const grown = JSON.parse(viewer.files()['transcript-run-1-0'] ?? '[]') as ChatEntry[];
    expect(grown.map((entry) => (entry.type === 'agent' ? entry.text : ''))).toEqual(['Reading.', 'Done.']);
  });

  test('a run with no transcript yet streams nothing, and one past the size a file carries keeps its latest entries', async () => {
    const transcripts = createTranscripts();
    const { publisher } = sharedSetUp({ preset: 'everything', transcripts });
    expect(Object.keys((await publisher.resolveLive('task-1')).view.files)).not.toContain(
      'transcript-run-1-0'
    );
    transcripts.record('run-1', { type: 'agent', phase: 'interim', text: 'x'.repeat(SHARE_FILE_BYTES) });
    transcripts.record('run-1', { type: 'agent', phase: 'final', text: 'Done.' });
    const file = (await publisher.resolveLive('task-1')).files.find(
      (item) => item.id === 'transcript-run-1-0'
    );
    const kept = JSON.parse(decodeText((await file?.read()) as Bytes)) as ChatEntry[];
    expect(kept.map((entry) => (entry.type === 'agent' ? entry.text : ''))).toEqual(['Done.']);
  });
});
