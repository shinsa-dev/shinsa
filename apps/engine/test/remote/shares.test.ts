import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
  type Repo,
  type ShareMessage,
  type SharePreset,
  type ShinsaState,
  serializeBase64Url,
  serializeShareUrl,
  type Task,
  SHARE_PRESET_SCOPES,
  type ViewScope,
} from '@shinsa/core';
import { Clock, Effect, Layer, Option } from 'effect';
import type { Transcripts } from '../../src/agents/transcripts/service.ts';
import { RandomBytes } from '../../src/remote/schema.ts';
import { SHARE_GONE_REASON } from '../../src/remote/share-channel/schema.ts';
import {
  SHARE_LINK_LOST,
  SHARE_NOT_PAIRED,
  SHARE_REMOTE_CHANGED,
  ShareCodeUnreadable,
  ShareSources,
} from '../../src/remote/shares/schema.ts';
import { readWorktreeFile as readWorktreeFileEffect } from '../../src/remote/shares/worktree-file.ts';
import { EffectFailed } from '../../src/runtime/failures/schema.ts';
import { runFiles } from '../harness.ts';
import { createTestEvidence } from '../helpers/evidence.ts';
import { createWorktree } from '../helpers/git.ts';
import { createGitRepo, createTempDir, overrideEnv, until } from '../helpers/index.ts';
import { createRepo, createRun, createStubEngine, createTask } from '../helpers/state.ts';
import { type FakeControlPlane, startFakeControlPlane } from './control-plane.ts';
import { adaptRemote, adaptShares, createRemoteTest } from './harness.ts';

const MONA = { id: '1', login: 'mona', name: 'Mona Lisa', avatarUrl: 'https://avatars.example/mona' };

const CREDENTIALS = {
  instanceId: 'inst1',
  machineToken: 'machine-token',
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

const SHARING = { at: 1, limit: 'none', scopes: SHARE_PRESET_SCOPES.standard, endsAt: null } as const;

let running: FakeControlPlane | null = null;

afterEach(async () => {
  await running?.stop();
  running = null;
});

interface ShareGitHub {
  readDiff: (repo: Repo, number: number) => Promise<string>;
  readFile: (repo: Repo, ref: string, path: string) => Promise<string>;
}

interface ShareWorktree {
  readBase: (repo: Repo, task: Task) => Promise<string>;
  readPatch: (worktree: string, base: string) => Promise<string>;
  readFile: (worktree: string, path: string) => Promise<string>;
}

type Shares = ReturnType<typeof adaptShares>;

function readWorktreeFile(worktree: string, path: string) {
  return runFiles(readWorktreeFileEffect(worktree, path));
}

const enterCode = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (error) =>
      new ShareCodeUnreadable({ message: error instanceof Error ? error.message : String(error) }),
  });

function countClock(onRead: () => void) {
  return Layer.effect(
    Clock.Clock,
    Effect.map(Clock.clockWith(Effect.succeed), (clock) =>
      Object.assign(Object.create(clock) as Clock.Clock, {
        currentTimeMillisUnsafe: () => {
          onRead();
          return clock.currentTimeMillisUnsafe();
        },
        currentTimeMillis: Effect.sync(() => {
          onRead();
          return clock.currentTimeMillisUnsafe();
        }),
      })
    )
  );
}

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

interface FakeTranscripts {
  runs: Map<string, ChatEntry[]>;
  record: (runId: string, event: ChatEvent) => void;
  service: Partial<Transcripts['Service']>;
}

function createTranscripts(): FakeTranscripts {
  const listeners = new Set<(runId: string, entries: ChatEntry[], start: number | null) => void>();
  const runs = new Map<string, ChatEntry[]>();
  return {
    runs,
    service: {
      listEntries: (runId) => Effect.sync(() => [...(runs.get(runId) ?? [])]),
      subscribe: (listener) =>
        Effect.sync(() => {
          listeners.add(listener);
          return Effect.sync(() => {
            listeners.delete(listener);
          });
        }),
    },
    record: (runId, event) => {
      const entries = runs.get(runId) ?? [];
      entries.push({ ...event, v: CHAT_PROTOCOL_VERSION, id: `e${entries.length}`, at: 1 } as ChatEntry);
      runs.set(runId, entries);
      for (const listener of listeners) listener(runId, entries, null);
    },
  };
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
  worktree?: ShareWorktree;
  patch?: (state: ShinsaState) => void;
  transcripts?: FakeTranscripts;
  sources?: boolean;
  random?: boolean;
  onClock?: () => void;
}

async function setUp(options: SetUp = {}) {
  const plane = startFakeControlPlane();
  running = plane;
  const dir = createTempDir();
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
  const { worktree } = options;
  let fill = 7;
  const machine = await createRemoteTest({
    dataDir: dir,
    ...((options.paired ?? true)
      ? {
          file: {
            credentials: CREDENTIALS,
            enabled: true,
            owner: 'mona',
            access: { owner: MONA, members: [] },
          },
        }
      : {}),
    origin: plane.origin,
    engine: stub.engine.core,
    transcripts: transcripts.service,
    evidence: createTestEvidence(evidenceDir),
    layers: Layer.mergeAll(
      options.sources === false
        ? Layer.empty
        : Layer.succeed(ShareSources, {
            github: {
              readDiff: (repo, number) => enterCode(() => github.readDiff(repo, number)),
              readFile: (repo, ref, path) => enterCode(() => github.readFile(repo, ref, path)),
            },
            worktree: worktree
              ? {
                  readBase: (repo, task) => enterCode(() => worktree.readBase(repo, task)),
                  readPatch: (path, base) => enterCode(() => worktree.readPatch(path, base)),
                  readFile: (path, file) => enterCode(() => worktree.readFile(path, file)),
                }
              : null,
          }),
      options.random === false
        ? Layer.empty
        : Layer.succeed(RandomBytes, (bytes: number) => new Uint8Array(bytes).fill(fill++)),
      options.onClock ? countClock(options.onClock) : Layer.empty
    ),
  });
  const publisher = adaptShares(machine);
  const remote = adaptRemote(machine);
  return { plane, stub, publisher, github, remote, transcripts, evidenceDir };
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
  const link = Option.getOrNull(parseShareUrl(url));
  if (!link) throw new Error('not a share link');
  const ephemeral = (await crypto.subtle.generateKey(REMOTE_KEY_ALGORITHM, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const hello = await Effect.runPromise(createShareHello(link.shareId, link.key, ephemeral.publicKey));
  let open: ReturnType<typeof createFrameOpener> | null = null;
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
        if (message.t === 'body')
          files[message.id] += decodeText(Option.getOrNull(parseBodyChunk(message.chunk)) as Bytes);
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
            const welcome = Option.getOrNull(parseShareWelcome(data));
            if (welcome?.type === 'refused') viewer.refused = welcome.reason;
            if (welcome?.type !== 'welcome') return;
            const key = await Effect.runPromise(
              deriveShareSessionKey(
                link.key,
                { share: link.shareId, clientEphemeral: hello.ephemeral, serverEphemeral: welcome.ephemeral },
                ephemeral.privateKey,
                welcome.ephemeral
              )
            );
            open = createFrameOpener(key);
            return;
          }
          if (!open) throw new Error('a frame before the welcome');
          const message = Option.getOrNull(
            parseShareMessage(decodeText(await Effect.runPromise(open(data as Bytes))))
          );
          if (message) viewer.messages.push(message);
        });
      },
      close: (code, reason) => {
        queue = queue.then(() => {
          viewer.closed = { code, reason };
        });
      },
    },
    shareId
  );
  await channel.receive(JSON.stringify(hello));
  await queue;
  return viewer;
}

async function sharedSetUp(options: SetUp & { preset?: SharePreset; scopes?: readonly ViewScope[] } = {}) {
  return setUp({
    ...options,
    patch: (state) => {
      state.tasks['task-1'] = shareTask({
        share: {
          ...SHARING,
          scopes: options.scopes ?? SHARE_PRESET_SCOPES[options.preset ?? 'standard'],
          url: SHARE_URL,
        },
      });
      state.runs['run-1'] = createRun();
      options.patch?.(state);
    },
  });
}

describe('making a share link', () => {
  test('a new share gets a link to this machine with a fresh id and a key only in its fragment', async () => {
    const { stub, publisher, plane } = await setUp();
    await publisher.link('task-1', CONTEXT);
    const recorded = stub.dispatched[0] as { url: string };
    const key = serializeBase64Url(new Uint8Array(32).fill(8));
    expect(recorded.url).toBe(
      serializeShareUrl(plane.origin, { instanceId: 'inst1', shareId: SHARE_ID, key })
    );
    expect(Option.getOrNull(parseShareUrl(recorded.url))?.shareId).toBe(SHARE_ID);
    expect(stub.commandIds).toEqual([`${CONTEXT.key}:share.record`]);
  });

  test('a link to this machine is kept, and one to an earlier pairing is replaced', async () => {
    const { stub, publisher } = await sharedSetUp();
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
    expect(Option.getOrNull(parseShareUrl((stub.dispatched[1] as { url: string }).url))?.instanceId).toBe(
      'inst1'
    );
  });

  test('a key and an id come from the system random source by default', async () => {
    const { stub, publisher: shares } = await setUp({ random: false });
    await shares.link('task-1', CONTEXT);
    const link = Option.getOrNull(parseShareUrl((stub.dispatched[0] as { url: string }).url));
    expect(link?.key).toHaveLength(43);
    expect(link?.shareId).not.toBe(SHARE_ID);
  });

  test('a machine that is not paired fails for good, saying how to turn remote access on', async () => {
    const { publisher } = await setUp({ paired: false });
    const failure = await publisher.link('task-1', CONTEXT).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(EffectFailed);
    expect((failure as EffectFailed).message).toBe(SHARE_NOT_PAIRED);
    expect((failure as EffectFailed).retryable).toBe(false);
  });

  test('a task that is no longer shared gets no link', async () => {
    const { stub, publisher } = await setUp({
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
    const { plane, publisher } = await sharedSetUp();
    expect(publisher.acceptsShare(SHARE_ID)).toBe(true);
    expect(publisher.acceptsShare('other')).toBe(false);
    const viewer = await openViewer(publisher);
    await until('the viewer reads it', () =>
      viewer.messages.some((message) => message.t === 'end' && message.id === SHARE_CODE_FILE)
    );
    const [view] = viewer.views();
    expect(view?.shared).toMatchObject({
      owner: 'mona',
      ownerProfile: { name: 'Mona Lisa', avatarUrl: 'https://avatars.example/mona' },
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

  test('a field the redaction does not name never leaves', async () => {
    const { publisher } = await sharedSetUp({
      preset: 'full',
      patch: (state) => {
        const task = state.tasks['task-1'] as Task;
        Object.assign(task.pullRequest ?? {}, { reviewToken: 'ghp_secret' });
        state.runs['run-1'] = {
          ...createRun(),
          delegation: {
            parentRunId: 'run-0',
            depth: 1,
            requestKey: 'key',
            title: 'Review',
            brief: 'the whole brief',
            mode: 'async',
            wake: 'result',
            isolation: 'shared',
            baseCommit: null,
            delivery: 'pending',
            question: null,
            requestedAt: 1,
            worktree: '/Users/mona/secret',
          },
        } as never;
      },
    });
    const viewer = await openViewer(publisher);
    await until('the viewer reads the view', () => viewer.views().length > 0);
    const [view] = viewer.views();
    expect(view?.shared.task.pullRequest).not.toHaveProperty('reviewToken');
    expect(view?.shared.runs[0]?.delegation).not.toHaveProperty('worktree');
    expect(view?.shared.runs[0]?.delegation?.brief).toBe('');
  });

  test('pushes a change at once, sends a file again only when it changed, and reads GitHub once per head', async () => {
    const { stub, publisher, github } = await sharedSetUp();
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
    const { stub, publisher } = await sharedSetUp();
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
    const { stub, publisher } = await sharedSetUp();
    stub.state.tasks['task-1'] = shareTask({
      share: { ...SHARING, limit: 'hour', scopes: SHARE_PRESET_SCOPES.standard, endsAt: 0, url: SHARE_URL },
    });
    const expired = await openViewer(publisher);
    expect(expired.refused).toBe(SHARE_GONE_REASON);
  });

  test('takes nothing from the viewer: any message after the hello closes it', async () => {
    const { publisher } = await sharedSetUp();
    const viewer = await openViewer(publisher);
    await viewer.send(JSON.stringify({ type: 'task.prioritize', taskId: 'task-1', priority: 'urgent' }));
    expect(viewer.closed).toEqual({ code: 1008, reason: 'A share link only listens.' });
    const mismatched = await openViewer(publisher, SHARE_URL, 'other');
    expect(mismatched.closed?.reason).toBe('The share link expects a hello first.');
  });

  test('ends every open link when remote access is turned off', async () => {
    const { publisher, remote } = await sharedSetUp();
    const viewer = await openViewer(publisher);
    await remote.disable();
    await until('the viewer reads it', () => viewer.closed !== null);
    expect(viewer.closed?.reason).toBe(SHARE_REMOTE_CHANGED);
    expect(publisher.acceptsShare(SHARE_ID)).toBe(false);
  });

  test('a file too large to stream is left out, and the evidence it shows with it', async () => {
    const github = createGitHub('x'.repeat(SHARE_FILE_BYTES + 1));
    const { publisher } = await sharedSetUp({
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
    const { stub, publisher } = await sharedSetUp({ github });
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
    const { stub, publisher } = await sharedSetUp();
    const viewer = await openViewer(publisher);
    const channel = publisher.openChannel({ send: () => undefined, close: () => undefined }, SHARE_ID);
    publisher.closeChannel(channel);
    stub.notify();
    expect(viewer.closed).toBeNull();
  });
});

describe('when this machine is paired again', () => {
  test('every link it shared is marked as no longer working, so Share again makes a new one', async () => {
    const { stub, remote } = await setUp({
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
    const { stub, remote } = await setUp({
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
    const { plane, publisher } = await setUp({
      paired: false,
      patch: (state) => {
        state.tasks['task-1'] = shareTask({ share: null });
        state.evidence.page = createEvidence({ id: 'page', uri: '/api/evidence/page.html', attachedAt: 2 });
      },
    });
    const { view } = await publisher.resolveLive('task-1');
    expect(Object.keys(view.files)).toEqual(['shot-1', SHARE_DIFF_FILE, SHARE_CODE_FILE]);
    expect(view.shared.evidence.map((item) => item.id)).toEqual(['shot-1']);
    expect(view.shared).toMatchObject({ owner: null, ownerProfile: null, machine: 'Studio', code: true });
    expect(await readLiveFile(publisher, SHARE_DIFF_FILE)).toBe(DIFF);
    expect(plane.calls).toEqual([]);
  });

  test('a task without a pull request or a working copy shows no code and reads nothing from GitHub', async () => {
    const { publisher, github } = await setUp({
      patch: (state) => {
        state.tasks['task-1'] = shareTask({ pullRequest: null, worktreePath: null });
      },
    });
    const { view } = await publisher.resolveLive('task-1');
    expect(Object.keys(view.files)).toEqual(['shot-1']);
    expect(view.shared.code).toBe(false);
    expect(github.diffReads).toBe(0);
  });

  test('before a pull request, the code comes from the working copy, read again only when the task changes', async () => {
    const worktreePath = createTempDir();
    const reads: string[] = [];
    const worktree: ShareWorktree = {
      readBase: () => Promise.resolve('base-sha'),
      readPatch: (path, base) => {
        reads.push(`${path}@${base}`);
        return Promise.resolve(DIFF);
      },
      readFile: (path, file) => Promise.resolve(`working ${file} in ${path}`),
    };
    const { publisher, github, stub } = await setUp({
      worktree,
      patch: (state) => {
        state.tasks['task-1'] = shareTask({ pullRequest: null, worktreePath, updatedAt: 5 });
      },
    });
    const { view, files } = await publisher.resolveLive('task-1');
    expect(view.shared.code).toBe(true);
    expect(view.files[SHARE_DIFF_FILE]).toEqual({ version: 'working:5:0', type: 'text/plain' });
    const code = files.find((file) => file.id === SHARE_CODE_FILE);
    expect(new TextDecoder().decode(await code?.read())).toContain(`working src/a.ts in ${worktreePath}`);
    await publisher.resolveLive('task-1');
    expect(reads).toEqual([`${worktreePath}@base-sha`]);
    expect(github.diffReads).toBe(0);
    stub.state.tasks['task-1'] = shareTask({ pullRequest: null, worktreePath, updatedAt: 6 });
    await publisher.resolveLive('task-1');
    expect(reads).toHaveLength(2);
  });

  test('an agent’s tool call reads the working copy again, since its edits record no task event', async () => {
    const reads: string[] = [];
    const worktree: ShareWorktree = {
      readBase: () => Promise.resolve('base-sha'),
      readPatch: (path) => {
        reads.push(path);
        return Promise.resolve(DIFF);
      },
      readFile: () => Promise.resolve('edited'),
    };
    const worktreePath = createTempDir();
    const { publisher, transcripts } = await setUp({
      worktree,
      patch: (state) => {
        state.tasks['task-1'] = shareTask({ pullRequest: null, worktreePath, updatedAt: 5 });
        state.runs['run-1'] = createRun();
      },
    });
    await publisher.resolveLive('task-1');
    transcripts.record('run-1', { type: 'agent', phase: 'interim', text: 'Editing.' });
    await publisher.resolveLive('task-1');
    expect(reads).toHaveLength(1);
    transcripts.record('run-1', {
      type: 'tool_result',
      callId: 'c1',
      status: 'ok',
      output: 'ok',
      images: [],
    });
    const { view } = await publisher.resolveLive('task-1');
    expect(reads).toHaveLength(2);
    expect(view.files[SHARE_DIFF_FILE]?.version).toBe('working:5:1');
  });

  test('a changed symlink shares its target path, never the file it points to', async () => {
    const worktree = createTempDir();
    const outside = join(createTempDir(), 'secret.txt');
    writeFileSync(outside, 'ssh key');
    symlinkSync(outside, join(worktree, 'link'));
    expect(await readWorktreeFile(worktree, 'link')).toBe(outside);
  });

  test('a path through a symlinked folder that leads outside the working copy is refused', async () => {
    const worktree = createTempDir();
    const outside = createTempDir();
    writeFileSync(join(outside, 'id_rsa'), 'ssh key');
    symlinkSync(outside, join(worktree, 'keys'));
    await expect(readWorktreeFile(worktree, 'keys/id_rsa')).rejects.toThrow('leads outside the working copy');
    writeFileSync(join(worktree, 'a.ts'), 'inside');
    expect(await readWorktreeFile(worktree, 'a.ts')).toBe('inside');
  });

  test('an evidence file removed after it was listed fails to read', async () => {
    const { publisher, evidenceDir } = await setUp();
    const shot = (await publisher.resolveLive('task-1')).files.find((file) => file.id === 'shot-1');
    rmSync(join(evidenceDir, 'settings.png'));
    await expect(shot?.read() ?? Promise.resolve()).rejects.toBeDefined();
  });

  test('a path that is missing, or a folder, is refused', async () => {
    const worktree = createTempDir();
    mkdirSync(join(worktree, 'src'));
    await expect(readWorktreeFile(worktree, 'missing.ts')).rejects.toThrow('missing.ts');
    await expect(readWorktreeFile(worktree, 'src')).rejects.toBeDefined();
  });

  test('by default the code comes from GitHub through gh, and a pull request gh cannot read leaves it out', async () => {
    const state = join(createTempDir(), 'gh.json');
    writeFileSync(
      state,
      JSON.stringify({
        next: 1,
        defaultChecks: 'pending',
        pulls: [],
        calls: [],
        diffs: { '7': DIFF },
        contents: { 'src/a.ts@abc123': 'from gh' },
      })
    );
    const restore = overrideEnv({ FAKE_GH_STATE: state });
    try {
      const { stub, publisher: shares } = await setUp({
        sources: false,
        patch: (current) => {
          current.repos['repo-1'] = createRepo({ path: createTempDir() });
          delete current.evidence['shot-1'];
        },
      });
      const live = await shares.resolveLive('task-1');
      const code = live.files.find((file) => file.id === SHARE_CODE_FILE);
      expect(JSON.parse(decodeText((await code?.read()) as Bytes))).toEqual({
        files: { 'src/a.ts': 'from gh' },
      });
      const task = shareTask();
      stub.state.tasks['task-1'] = {
        ...task,
        pullRequest: task.pullRequest && { ...task.pullRequest, number: 8 },
      };
      expect(Object.keys((await shares.resolveLive('task-1')).view.files)).toEqual([]);
    } finally {
      restore();
    }
  });

  test('the working copy’s code is read from its checkout, against the branch’s base', async () => {
    const { repo } = await createGitRepo({ remote: false, files: { 'src/a.ts': 'export const a = 1;\n' } });
    const checkout = await createWorktree(repo, createTempDir(), 'task-eeeeee', 'fix/live', null);
    writeFileSync(join(checkout.path, 'src/a.ts'), 'export const a = 2;\n');
    const { publisher } = await setUp({
      patch: (state) => {
        state.repos['repo-1'] = createRepo({ path: repo.path });
        state.tasks['task-1'] = shareTask({
          pullRequest: null,
          worktreePath: checkout.path,
          branch: 'fix/live',
        });
      },
    });
    const { files } = await publisher.resolveLive('task-1');
    const read = async (id: string) =>
      new TextDecoder().decode(await files.find((file) => file.id === id)?.read());
    expect(await read(SHARE_DIFF_FILE)).toContain('+export const a = 2;');
    expect(JSON.parse(await read(SHARE_CODE_FILE))).toEqual({
      files: { 'src/a.ts': 'export const a = 2;\n' },
    });
  });

  test('a working copy that cannot be read leaves the code out', async () => {
    const worktree: ShareWorktree = {
      readBase: () => Promise.reject(new Error('no base')),
      readPatch: () => Promise.resolve(''),
      readFile: () => Promise.resolve(''),
    };
    const worktreePath = createTempDir();
    const { publisher } = await setUp({
      worktree,
      patch: (state) => {
        state.tasks['task-1'] = shareTask({ pullRequest: null, worktreePath });
      },
    });
    const { view } = await publisher.resolveLive('task-1');
    expect(view.files[SHARE_DIFF_FILE]).toBeUndefined();
  });

  test('a working copy that is gone shows no code', async () => {
    const { publisher } = await setUp({
      patch: (state) => {
        state.tasks['task-1'] = shareTask({ pullRequest: null, worktreePath: '/nowhere/at/all' });
      },
    });
    const { view } = await publisher.resolveLive('task-1');
    expect(view.files[SHARE_DIFF_FILE]).toBeUndefined();
  });

  test('an unknown task shows nothing', async () => {
    const { publisher } = await setUp();
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
    const { publisher } = await setUp({ github });
    expect(JSON.parse((await readLiveFile(publisher, SHARE_CODE_FILE)) ?? '')).toEqual({
      files: { 'src/a.ts': 'src/a.ts@abc123' },
    });
    expect(github.fileReads).toEqual(['src/a.ts@abc123', 'src/lost.ts@abc123']);
  });

  test('changed files past the size a file can carry are left out', async () => {
    const big = 'x'.repeat(SHARE_FILE_BYTES);
    const diff = ['diff --git a/a.ts b/a.ts', 'diff --git a/b.ts b/b.ts'].join('\n');
    const github = createGitHub(diff, (_repo, _ref, path) => Promise.resolve(path === 'a.ts' ? 'a' : big));
    const { publisher } = await setUp({ github });
    expect(JSON.parse((await readLiveFile(publisher, SHARE_CODE_FILE)) ?? '')).toEqual({
      files: { 'a.ts': 'a' },
    });
  });

  test('a pull request with no pushed head shares its diff and no whole files', async () => {
    const { publisher, github } = await setUp({
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
    const { publisher, github } = await sharedSetUp({ preset: 'status' });
    const live = await publisher.resolveLive('task-1');
    expect(live.view.shared).toMatchObject({
      scopes: [...SHARE_PRESET_SCOPES.status],
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

  test('a status share streams no transcript', async () => {
    const transcripts = createTranscripts();
    transcripts.record('run-1', { type: 'agent', phase: 'final', text: 'Done.' });
    let builds = 0;
    const { publisher } = await sharedSetUp({
      transcripts,
      preset: 'status',
      onClock: () => {
        builds += 1;
      },
    });
    const live = await publisher.resolveLive('task-1');
    expect(Object.keys(live.view.files)).not.toContain('transcript-run-1-0');
    const viewer = await openViewer(publisher);
    await until('the viewer has the view', () => viewer.views().length > 0);
    await Bun.sleep(0);
    builds = 0;
    transcripts.record('run-1', { type: 'agent', phase: 'final', text: 'Again.' });
    await Bun.sleep(0);
    expect(builds).toBe(0);
  });

  test('a default share sends a full page of a transcript once, and only its last page as it grows', async () => {
    const transcripts = createTranscripts();
    for (let index = 0; index <= SHARE_TRANSCRIPT_PAGE; index += 1) {
      transcripts.record('run-1', { type: 'agent', phase: 'interim', text: `Step ${index}` });
    }
    const { publisher } = await sharedSetUp({ preset: 'standard', transcripts });
    const viewer = await openViewer(publisher);
    await until('the viewer reads both pages', () => 'transcript-run-1-1' in viewer.files());
    transcripts.record('run-1', { type: 'agent', phase: 'final', text: 'Done.' });
    await until(
      'the viewer reads the last page again',
      () =>
        viewer.messages.some(
          (message) =>
            message.t === 'file' && message.id === 'transcript-run-1-1' && message.version === 'agents:2'
        ) && (viewer.files()['transcript-run-1-1'] ?? '').includes('Done.')
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

  test('a default share streams each run without your turns, and again as it grows', async () => {
    const transcripts = createTranscripts();
    transcripts.record('run-1', {
      type: 'user',
      from: 'shinsa',
      text: 'Build phase 1. sk-0000',
      attachments: [],
    });
    transcripts.record('run-1', { type: 'agent', phase: 'interim', text: 'Reading.' });
    transcripts.record('run-2', { type: 'agent', phase: 'interim', text: 'Another task.' });
    const { publisher } = await sharedSetUp({ preset: 'standard', transcripts });
    const viewer = await openViewer(publisher);
    await until('the viewer reads the transcript', () => 'transcript-run-1-0' in viewer.files());
    expect(viewer.views()[0]?.files['transcript-run-1-0']).toEqual({
      version: 'agents:2',
      type: 'text/plain',
    });
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
      viewer.messages.some((message) => message.t === 'file' && message.version === 'agents:3')
    );
    await until('its body arrives', () => (viewer.files()['transcript-run-1-0'] ?? '').includes('Done.'));
    const grown = JSON.parse(viewer.files()['transcript-run-1-0'] ?? '[]') as ChatEntry[];
    expect(grown.map((entry) => (entry.type === 'agent' ? entry.text : ''))).toEqual(['Reading.', 'Done.']);
  });

  test('an everything share streams your own turns too, never the prompts Shinsa sends', async () => {
    const transcripts = createTranscripts();
    transcripts.record('run-1', {
      type: 'user',
      from: 'shinsa',
      text: 'Build phase 1. sk-0000',
      attachments: [],
    });
    transcripts.record('run-1', { type: 'user', from: 'you', text: 'Try the left pane.', attachments: [] });
    transcripts.record('run-1', { type: 'agent', phase: 'final', text: 'Done.' });
    const { publisher } = await sharedSetUp({ preset: 'full', transcripts });
    const file = (await publisher.resolveLive('task-1')).files.find(
      (item) => item.id === 'transcript-run-1-0'
    );
    expect(file?.version).toBe('messages:3');
    const shared = JSON.parse(decodeText((await file?.read()) as Bytes)) as ChatEntry[];
    expect(shared.map((entry) => entry.type)).toEqual(['user', 'agent']);
    expect(JSON.stringify(shared)).not.toContain('sk-0000');
  });

  test('a custom share without code and with messages reads no diff, names its scopes and streams your own turns', async () => {
    const transcripts = createTranscripts();
    transcripts.record('run-1', { type: 'user', from: 'you', text: 'Try the left pane.', attachments: [] });
    transcripts.record('run-1', { type: 'agent', phase: 'final', text: 'Done.' });
    const scopes = [
      ...SHARE_PRESET_SCOPES.standard.filter((scope) => scope !== 'code'),
      'messages',
    ] as const satisfies readonly ViewScope[];
    const { publisher, github } = await sharedSetUp({ scopes, transcripts });
    const live = await publisher.resolveLive('task-1');
    expect(live.view.shared.scopes).not.toContain('code');
    expect(live.view.shared.scopes).toContain('messages');
    expect(live.view.shared.code).toBe(false);
    expect(Object.keys(live.view.files)).not.toContain(SHARE_DIFF_FILE);
    expect(Object.keys(live.view.files)).not.toContain(SHARE_CODE_FILE);
    expect(github.diffReads).toBe(0);
    const file = live.files.find((item) => item.id === 'transcript-run-1-0');
    expect(file?.version).toBe('messages:2');
  });

  test('a custom share with code but without people shows the code and still names no one and no repository', async () => {
    const scopes = ['identity', 'progress', 'code'] as const satisfies readonly ViewScope[];
    const { publisher } = await sharedSetUp({ scopes });
    const live = await publisher.resolveLive('task-1');
    expect(live.view.shared).toMatchObject({ code: true, owner: null, machine: null, repository: null });
    expect(Object.keys(live.view.files)).toContain(SHARE_DIFF_FILE);
  });

  test('a scope list passed to the live view replaces the share’s own, as a team view does', async () => {
    const { publisher } = await sharedSetUp({ preset: 'full' });
    const live = await publisher.resolveLive('task-1', SHARE_PRESET_SCOPES.status);
    expect(live.view.shared.scopes).toEqual([...SHARE_PRESET_SCOPES.status]);
    expect(live.view.shared.owner).toBeNull();
  });

  test('a run with no transcript yet streams nothing, and one past the size a file carries keeps its latest entries', async () => {
    const transcripts = createTranscripts();
    const { publisher } = await sharedSetUp({ preset: 'standard', transcripts });
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
