import { describe, expect, spyOn, test } from 'bun:test';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  DomainError,
  type FastModeAvailability,
  resolveHouseRules,
  type ShinsaCommand,
  type ShinsaState,
} from '@shinsa/core';
import {
  type RunRejection,
  RunSupervisor,
  type SupervisorOptions,
  Transcripts,
} from '../../src/agents/index.ts';
import { CLAUDE_CAPABILITIES } from '../../src/agents/providers/claude/index.ts';
import {
  type AgentProvider,
  type AgentSession,
  type AgentSessionInput,
  type AgentSessionResult,
  ProviderRegistry,
  type SessionStarter,
} from '../../src/agents/providers/index.ts';
import { log } from '../../src/log/index.ts';
import { Engine } from '../../src/runtime/index.ts';
import { EventLog, EvidenceStore } from '../../src/store/index.ts';
import { createGitRepo, createTempDir, createTestConfig, git, until, writeFiles } from '../helpers/index.ts';
import {
  createGate,
  createRepo,
  createRun,
  createStubEngine,
  createTask,
  type StubEngine,
} from '../helpers/state.ts';
import { createInfo } from '../terminals/fakes.ts';

type Broker = NonNullable<SupervisorOptions['accounts']>;

function createBroker(lease: Broker['lease']): Broker {
  return {
    lease,
    readWeeklyReading: () => Promise.resolve(null),
    readProviderWeeklyReading: () => Promise.resolve(null),
    readFastMode: () => Promise.resolve('available'),
  };
}

interface FakeSession {
  input: AgentSessionInput;
  session: AgentSession;
  finish: (outcome?: 'completed' | 'failed', extra?: Partial<AgentSessionResult>) => void;
  steers: string[];
  cancelled: boolean;
}

function createSessions(
  options: { cancelFails?: boolean; throwOnStart?: boolean; refuseSteer?: boolean } = {}
) {
  const started: FakeSession[] = [];
  const startSession = (input: AgentSessionInput): AgentSession => {
    if (options.throwOnStart) throw new Error('claude is not installed');
    const done = Promise.withResolvers<AgentSessionResult>();
    const fake: FakeSession = {
      input,
      steers: [],
      cancelled: false,
      finish: (outcome = 'completed', extra = {}) => done.resolve({ outcome, summary: outcome, ...extra }),
      session: {
        done: done.promise,
        steer: (text, from) => {
          if (options.refuseSteer) return false;
          fake.steers.push(from ? `${from}: ${text}` : text);
          return true;
        },
        cancel: () => {
          fake.cancelled = true;
          done.resolve({ outcome: 'cancelled', summary: null });
          return options.cancelFails ? Promise.reject(new Error('already gone')) : Promise.resolve();
        },
      },
    };
    started.push(fake);
    return fake.session;
  };
  return { started, startSession };
}

function setup(
  patch: (state: ShinsaState) => void,
  options: SupervisorOptions & { evidenceDir?: string } = {}
) {
  const stub = createStubEngine(patch);
  const config = createTestConfig();
  const transcripts = new Transcripts(config.transcriptsDir);
  const evidence = new EvidenceStore(options.evidenceDir ?? config.evidenceDir);
  const supervisor = new RunSupervisor(stub.engine, config, transcripts, evidence, options);
  return { ...stub, config, transcripts, supervisor };
}

function withTask(worktreePath: string, runs = [createRun()]) {
  return (state: ShinsaState) => {
    state.repos['repo-1'] = createRepo();
    state.tasks['task-1'] = createTask({ worktreePath });
    for (const run of runs) state.runs[run.id] = run;
  };
}

function withIdleCompaction(patch: (state: ShinsaState) => void) {
  return (state: ShinsaState) => {
    patch(state);
    Object.assign(state.settings, {
      compaction: 'claude',
      idleCompaction: true,
      agentFastModes: { agent: true },
    });
  };
}

function endedRuns(dispatched: { type: string }[]) {
  return dispatched.filter((command) => command.type === 'run.end');
}

function continueRuns(respond: StubEngine['respond'], runIds: string[]) {
  respond(
    (command) => command.type === 'run.continue' && runIds.includes(command.runId),
    [{ type: 'run.continued', runId: 'any', reason: 'crash', seq: 1, at: 1 }]
  );
}

describe('starting and ending runs', () => {
  test('a run without a worktree ends as failed, and an unknown or finished run is ignored', async () => {
    const { supervisor, dispatched } = setup((state) => {
      state.runs['run-1'] = createRun();
      state.runs['run-2'] = createRun({ id: 'run-2', endedAt: 5 });
    });
    await supervisor.execute('run-1');
    await supervisor.execute('run-2');
    await supervisor.execute('missing');
    expect(dispatched).toEqual([
      { type: 'run.end', runId: 'run-1', outcome: 'failed', summary: 'The task has no worktree to run in.' },
    ]);
  });

  test('the session gets the run, the prompt override and the session to resume, and is linked once', async () => {
    const sessions = createSessions();
    const { supervisor, dispatched, reject } = setup(
      withTask(createTempDir(), [createRun({ sessionId: 'old', model: 'opus' })]),
      { startSession: sessions.startSession }
    );
    reject((command) => command.type === 'run.link');
    const running = supervisor.execute('run-1', 'Carry on');
    await until('the session', () => sessions.started.length === 1);
    const { input, finish } = sessions.started[0] as FakeSession;
    expect(input).toMatchObject({
      role: 'agent',
      readOnly: false,
      prompt: 'Carry on',
      model: 'opus',
      resume: 'old',
      defaultBranch: 'main',
    });
    input.onSession('old');
    input.onSession('new');
    input.onEntry({ type: 'agent', phase: 'interim', text: 'working' });
    await supervisor.execute('run-1');
    finish();
    await running;
    expect(dispatched.map((command) => command.type)).toEqual(['run.attempt', 'run.link', 'run.end']);
    expect(endedRuns(dispatched)[0]).toMatchObject({ outcome: 'completed' });
  });

  test('the round agent plans, builds and fixes as separate runs on one session, read-only only while it plans', async () => {
    const sessions = createSessions();
    const runs = [
      createRun({ id: 'run-1', purpose: 'plan', phaseIndex: null, sessionId: 'sess-1', startedAt: 1 }),
      createRun({ id: 'run-2', purpose: 'build', sessionId: 'sess-1', startedAt: 2 }),
      createRun({ id: 'run-3', purpose: 'fix', phaseIndex: null, sessionId: 'sess-1', startedAt: 3 }),
    ];
    const { supervisor } = setup(withTask(createTempDir(), runs), { startSession: sessions.startSession });
    for (const [index, run] of runs.entries()) {
      const running = supervisor.execute(run.id);
      await until('the session', () => sessions.started.length === index + 1);
      sessions.started[index]?.finish();
      await running;
    }
    expect(sessions.started.map((fake) => [fake.input.role, fake.input.readOnly, fake.input.resume])).toEqual(
      [
        ['agent', true, 'sess-1'],
        ['agent', false, 'sess-1'],
        ['agent', false, 'sess-1'],
      ]
    );
  });

  test('a run is handed the MCP servers and skills for its repository and project, and starts without them when they cannot be read', async () => {
    const places: unknown[] = [];
    const loaded = { servers: [], skills: [], plugins: [] };
    const extensions = {
      resolveSession: (place: unknown) => {
        places.push(place);
        if (places.length > 1) return Promise.reject(new Error('extensions.json is gone'));
        return Promise.resolve({
          servers: [],
          skills: [],
          plugins: {},
          skillsOff: [],
          codexServersOff: [],
          deferred: [],
          deferredSkills: [],
          loaded,
        });
      },
    };
    const sessions = createSessions();
    const { supervisor } = setup(withTask(createTempDir()), {
      startSession: sessions.startSession,
      extensions,
    });
    const first = supervisor.execute('run-1');
    await until('the session', () => sessions.started.length === 1);
    expect(sessions.started[0]?.input.extensions?.loaded).toBe(loaded);
    expect(places[0]).toEqual({ repoPath: expect.any(String), project: null });
    sessions.started[0]?.finish();
    await first;
    const warn = spyOn(log, 'warn').mockImplementation(() => undefined);
    const second = setup(withTask(createTempDir()), { startSession: sessions.startSession, extensions });
    const running = second.supervisor.execute('run-1');
    await until('the second session', () => sessions.started.length === 2);
    expect(sessions.started[1]?.input.extensions).toBeUndefined();
    expect(warn).toHaveBeenCalledWith('[Runs] Could not resolve the MCP servers and skills for a run', {
      runId: 'run-1',
      error: 'extensions.json is gone',
    });
    warn.mockRestore();
    sessions.started[1]?.finish();
    await running;
  });

  test('a resumed session keeps the set it ran with and announces it again only when the set changed', async () => {
    const maple = { servers: [{ name: 'maple', tokens: 4000 }], skills: [], plugins: [], deferred: [] };
    const linear = { ...maple, servers: [{ name: 'linear', tokens: 1000 }] };
    const pins: unknown[] = [];
    let next = maple;
    const extensions = {
      resolveSession: (_place: unknown, pin?: unknown) => {
        pins.push(pin ?? null);
        return Promise.resolve({
          servers: [],
          skills: [],
          plugins: {},
          skillsOff: [],
          codexServersOff: [],
          deferred: [],
          deferredSkills: [],
          loaded: next,
        });
      },
    };
    const sessions = createSessions();
    const earlier = createRun({ id: 'run-0', sessionId: 'old', startedAt: 1, endedAt: 2 });
    const { supervisor, transcripts } = setup(
      withTask(createTempDir(), [earlier, createRun({ sessionId: 'old' }), createRun({ id: 'run-2' })]),
      { startSession: sessions.startSession, extensions }
    );
    transcripts.record('run-0', { type: 'notice', notice: { kind: 'extensions', ...maple } });
    const resumed = supervisor.execute('run-1');
    await until('the resumed session', () => sessions.started.length === 1);
    expect(pins[0]).toEqual(maple);
    expect(sessions.started[0]?.input.announceExtensions).toBe(false);
    sessions.started[0]?.input.onSession('old');
    sessions.started[0]?.finish();
    await resumed;

    next = linear;
    const changed = supervisor.execute('run-1');
    await until('the session after the change', () => sessions.started.length === 2);
    expect(pins[1]).toEqual(maple);
    expect(sessions.started[1]?.input.announceExtensions).toBe(true);
    sessions.started[1]?.input.onSession('old');
    sessions.started[1]?.finish();
    await changed;

    const fresh = supervisor.execute('run-2');
    await until('the fresh session', () => sessions.started.length === 3);
    expect(pins[2]).toBeNull();
    expect(sessions.started[2]?.input.announceExtensions).toBe(true);
    sessions.started[2]?.finish();
    await fresh;
  });

  test('a run that left servers out can load one: the loader’s tools reach the agent and see the session', async () => {
    const calls: string[] = [];
    const attached: unknown[] = [];
    let closed = 0;
    const loader = {
      listSpecs: () => [
        { name: 'load_mcp_server', description: 'Load one.', inputSchema: { type: 'object' } },
      ],
      isLoaderTool: (name: string) => name === 'load_mcp_server',
      handle: (name: string, args: Record<string, unknown>) => {
        calls.push(`${name}:${String(args.name)}`);
        return Promise.resolve('Loaded maple.');
      },
      attach: (session: unknown) => attached.push(session),
      close: () => {
        closed += 1;
        return Promise.resolve();
      },
    };
    const extensions = {
      resolveSession: () =>
        Promise.resolve({
          servers: [],
          skills: [],
          plugins: {},
          skillsOff: [],
          codexServersOff: [],
          deferred: [],
          deferredSkills: [],
          loaded: { servers: [], skills: [], plugins: [] },
        }),
      createLoader: () => loader as never,
    };
    const sessions = createSessions();
    const { supervisor } = setup(withTask(createTempDir()), {
      startSession: sessions.startSession,
      extensions,
    });
    const running = supervisor.execute('run-1');
    await until('the session', () => sessions.started.length === 1);
    const input = sessions.started[0]?.input;
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'agent', version: '1.0.0' });
    await input?.tools.createServer().connect(serverSide);
    await client.connect(clientSide);
    expect((await client.listTools()).tools.map((tool) => tool.name)).toContain('load_mcp_server');
    await client.close();
    const signal = new AbortController().signal;
    expect(await input?.tools.handle('load_mcp_server', { name: 'maple' }, signal, 1)).toBe('Loaded maple.');
    expect(calls).toEqual(['load_mcp_server:maple']);
    expect(attached).toHaveLength(1);
    sessions.started[0]?.finish();
    await running;
    expect(closed).toBe(1);
  });

  test('without an injected starter, the run goes to the provider the default-provider setting names', async () => {
    const codex = createSessions();
    const claude = createSessions();
    const provider = (id: string, startSession: SessionStarter): AgentProvider => ({
      id,
      label: id,
      capabilities: CLAUDE_CAPABILITIES,
      startSession,
      listModels: () => Promise.resolve([]),
      complete: () => Promise.resolve(null),
    });
    const { supervisor, dispatched } = setup(
      (state) => {
        withTask(createTempDir())(state);
        state.settings.defaultProvider = 'codex';
      },
      {
        providers: new ProviderRegistry([
          provider('claude', claude.startSession),
          provider('codex', codex.startSession),
        ]),
      }
    );
    const running = supervisor.execute('run-1');
    await until('the codex session', () => codex.started.length === 1);
    codex.started[0]?.finish();
    await running;
    expect(claude.started).toHaveLength(0);
    expect(endedRuns(dispatched)).toEqual([
      expect.objectContaining({
        type: 'run.end',
        runId: 'run-1',
        outcome: 'completed',
        summary: 'completed',
      }),
    ]);
  });

  test('every session gets the compaction and its role’s fast mode, fast mode only on a provider that can run fast', async () => {
    const fast = createSessions();
    const plain = createSessions();
    const provider = (id: string, startSession: SessionStarter, fastMode: boolean): AgentProvider => ({
      id,
      label: id,
      capabilities: { ...CLAUDE_CAPABILITIES, fastMode },
      startSession,
      listModels: () => Promise.resolve([]),
      complete: () => Promise.resolve(null),
    });
    const { supervisor, update } = setup(withTask(createTempDir()), {
      providers: new ProviderRegistry([
        provider('claude', fast.startSession, true),
        provider('plain', plain.startSession, false),
      ]),
    });
    const first = supervisor.execute('run-1');
    await until('the first session', () => fast.started.length === 1);
    expect(fast.started[0]?.input).toMatchObject({ compaction: 'eunoe_compact', fastMode: false });
    fast.started[0]?.finish();
    await first;
    update((state) => {
      Object.assign(state.settings, { agentFastModes: { agent: true } });
      state.runs['run-1'] = { ...createRun(), endedAt: 2, outcome: 'completed' };
      state.runs['run-2'] = createRun({ id: 'run-2', startedAt: 3 });
    });
    const builder = supervisor.execute('run-2');
    await until('the agent session', () => fast.started.length === 2);
    expect(fast.started[1]?.input).toMatchObject({ role: 'agent', fastMode: true });
    fast.started[1]?.finish();
    await builder;
    update((state) => {
      Object.assign(state.settings, { fastMode: true, agentFastModes: { reviewer: false } });
      state.runs['run-2'] = { ...createRun({ id: 'run-2' }), endedAt: 4, outcome: 'completed' };
      state.runs['run-3'] = createRun({ id: 'run-3', role: 'reviewer', startedAt: 5 });
    });
    const fixer = supervisor.execute('run-3');
    await until('the reviewer session', () => fast.started.length === 3);
    expect(fast.started[2]?.input).toMatchObject({ role: 'reviewer', fastMode: false });
    fast.started[2]?.finish();
    await fixer;
    update((state) => {
      Object.assign(state.settings, {
        compaction: 'off',
        defaultProvider: 'plain',
        agentFastModes: { agent: true },
      });
      state.runs['run-3'] = {
        ...createRun({ id: 'run-3', purpose: 'fix' }),
        endedAt: 6,
        outcome: 'completed',
      };
      state.runs['run-4'] = createRun({ id: 'run-4', startedAt: 7 });
    });
    const second = supervisor.execute('run-4');
    await until('the plain session', () => plain.started.length === 1);
    expect(plain.started[0]?.input).toMatchObject({ compaction: 'off', fastMode: false });
    plain.started[0]?.finish();
    await second;
  });

  test('a session that cannot start fails the run with the reason', async () => {
    const { supervisor, dispatched } = setup(withTask(createTempDir()), {
      startSession: createSessions({ throwOnStart: true }).startSession,
    });
    await supervisor.execute('run-1');
    expect(endedRuns(dispatched)[0]).toMatchObject({ outcome: 'failed', summary: 'claude is not installed' });
  });

  test('a run past its time limit is stopped and fails, even when stopping it errors', async () => {
    const sessions = createSessions({ cancelFails: true });
    const { supervisor, dispatched } = setup(withTask(createTempDir()), {
      startSession: sessions.startSession,
      maxRunMs: 20,
    });
    await supervisor.execute('run-1');
    expect(sessions.started[0]?.cancelled).toBe(true);
    expect(endedRuns(dispatched)[0]).toMatchObject({
      outcome: 'failed',
      summary: 'It ran past its time limit without handing over.',
    });
  });

  test('edits by a reviewer or by the agent while it plans are set aside, and a stash that fails is only logged', async () => {
    const { path } = await createGitRepo({ remote: false });
    writeFiles(path, { 'touched.txt': 'x' });
    const sessions = createSessions();
    const { supervisor } = setup(withTask(path, [createRun({ role: 'reviewer' })]), {
      startSession: sessions.startSession,
    });
    const running = supervisor.execute('run-1');
    await until('the session', () => sessions.started.length === 1);
    sessions.started[0]?.finish();
    await running;
    expect(await git(path, 'status', '--porcelain')).toBe('');

    const empty = createTempDir();
    await git(empty, 'init', '-q');
    writeFiles(empty, { 'a.txt': 'x' });
    const planner = createSessions();
    const second = setup(withTask(empty, [createRun({ purpose: 'plan' })]), {
      startSession: planner.startSession,
    });
    const planning = second.supervisor.execute('run-1');
    await until('the planner', () => planner.started.length === 1);
    expect(planner.started[0]?.input).toMatchObject({ role: 'agent', readOnly: true });
    planner.started[0]?.finish();
    await planning;
    expect(endedRuns(second.dispatched)).toHaveLength(1);
  });

  test('a researcher runs in the worktree when there is one, else in the repository, whose own edits are never set aside', async () => {
    const { path: repoPath } = await createGitRepo({ remote: false });
    writeFiles(repoPath, { 'mine.txt': 'the human’s own work' });
    const sessions = createSessions();
    const { supervisor } = setup(
      (state) => {
        state.repos['repo-1'] = createRepo({ path: repoPath });
        state.tasks['task-1'] = createTask({ worktreePath: null, branch: null });
        state.runs['run-1'] = createRun({ role: 'researcher' });
      },
      { startSession: sessions.startSession }
    );
    const running = supervisor.execute('run-1');
    await until('the session', () => sessions.started.length === 1);
    expect(sessions.started[0]?.input.cwd).toBe(repoPath);
    sessions.started[0]?.finish();
    await running;
    expect(await git(repoPath, 'status', '--porcelain')).toBe('?? mine.txt');

    const { path: worktree } = await createGitRepo({ remote: false });
    writeFiles(worktree, { 'scratch.txt': 'x' });
    const inWorktree = createSessions();
    const second = setup(withTask(worktree, [createRun({ role: 'researcher' })]), {
      startSession: inWorktree.startSession,
    });
    const researching = second.supervisor.execute('run-1');
    await until('the session', () => inWorktree.started.length === 1);
    expect(inWorktree.started[0]?.input.cwd).toBe(worktree);
    inWorktree.started[0]?.finish();
    await researching;
    expect(await git(worktree, 'status', '--porcelain')).toBe('');
  });

  test('an investigator and the agent running an operation work in the task’s worktree and keep their edits there', async () => {
    for (const role of ['investigator', 'agent'] as const) {
      const { path: worktree } = await createGitRepo({ remote: false });
      writeFiles(worktree, { 'edit.txt': 'x' });
      const sessions = createSessions();
      const { supervisor } = setup(withTask(worktree, [createRun({ role })]), {
        startSession: sessions.startSession,
      });
      const running = supervisor.execute('run-1');
      await until('the session', () => sessions.started.length === 1);
      expect(sessions.started[0]?.input).toMatchObject({ role, cwd: worktree });
      sessions.started[0]?.finish();
      await running;
      expect(await git(worktree, 'status', '--porcelain')).toBe('?? edit.txt');
    }
  });

  test('images from tool results are kept as evidence, or dropped when they cannot be written', async () => {
    const sessions = createSessions();
    const { supervisor } = setup(withTask(createTempDir()), { startSession: sessions.startSession });
    const running = supervisor.execute('run-1');
    await until('the session', () => sessions.started.length === 1);
    const store = sessions.started[0]?.input.storeImage;
    expect(store?.('AAAA', 'image/png')).toMatch(/^\/api\/evidence\//);
    sessions.started[0]?.finish();
    await running;

    const broken = createSessions();
    const second = setup(withTask(createTempDir()), {
      startSession: broken.startSession,
      evidenceDir: join(createTempDir(), 'missing'),
    });
    const brokenRun = second.supervisor.execute('run-1');
    await until('the session', () => broken.started.length === 1);
    expect(broken.started[0]?.input.storeImage?.('AAAA', 'image/png')).toBeNull();
    broken.started[0]?.finish();
    await brokenRun;
  });
});

describe('one agent at a time in a worktree', () => {
  test('a second run waits for the first, and does not start if it ended meanwhile', async () => {
    const sessions = createSessions();
    const worktree = createTempDir();
    const { supervisor, update } = setup(
      withTask(worktree, [
        createRun(),
        createRun({ id: 'run-2', purpose: 'fix', prompt: 'Fix it.' }),
        createRun({ id: 'run-3', purpose: 'fix', prompt: 'Fix it.' }),
      ]),
      { startSession: sessions.startSession }
    );
    const first = supervisor.execute('run-1');
    await until('the first session', () => sessions.started.length === 1);
    const second = supervisor.execute('run-2');
    const third = supervisor.execute('run-3');
    await Bun.sleep(20);
    expect(sessions.started).toHaveLength(1);
    update((state) => {
      state.runs['run-3'] = createRun({ id: 'run-3', purpose: 'fix', endedAt: 9 });
    });
    sessions.started[0]?.finish();
    await first;
    await until('the second session', () => sessions.started.length === 2);
    sessions.started[1]?.finish();
    await Promise.all([second, third]);
    expect(sessions.started.map((fake) => fake.input.prompt)).toEqual(['Build phase 1', 'Fix it.']);
  });

  test('a run still going after the wait is cancelled so the next can start', async () => {
    const sessions = createSessions();
    const { supervisor } = setup(withTask(createTempDir(), [createRun(), createRun({ id: 'run-2' })]), {
      startSession: sessions.startSession,
      quiesceMs: 20,
    });
    const first = supervisor.execute('run-1');
    await until('the first session', () => sessions.started.length === 1);
    const second = supervisor.execute('run-2');
    await until('the second session', () => sessions.started.length === 2);
    expect(sessions.started[0]?.cancelled).toBe(true);
    sessions.started[1]?.finish();
    await Promise.all([first, second]);
  });

  test('a run that waited for an earlier one leaves no timer behind once that run ended', async () => {
    const sessions = createSessions();
    const { supervisor } = setup(withTask(createTempDir(), [createRun(), createRun({ id: 'run-2' })]), {
      startSession: sessions.startSession,
      quiesceMs: 987_654,
    });
    const set = spyOn(globalThis, 'setTimeout');
    const clear = spyOn(globalThis, 'clearTimeout');
    try {
      const first = supervisor.execute('run-1');
      await until('the first session', () => sessions.started.length === 1);
      const second = supervisor.execute('run-2');
      sessions.started[0]?.finish();
      await until('the second session', () => sessions.started.length === 2);
      sessions.started[1]?.finish();
      await Promise.all([first, second]);
      const index = set.mock.calls.findIndex(([, delay]) => delay === 987_654);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(clear).toHaveBeenCalledWith(set.mock.results[index]?.value);
    } finally {
      set.mockRestore();
      clear.mockRestore();
    }
  });

  test('quiesce without runs returns at once', async () => {
    const { supervisor } = setup(withTask(createTempDir()));
    await supervisor.quiesce('task-1');
  });
});

describe('steering, cancelling and recovering', () => {
  test('a message reaches a live session, otherwise it is delivered to the task', async () => {
    const sessions = createSessions();
    const { supervisor, dispatched } = setup(withTask(createTempDir()), {
      startSession: sessions.startSession,
    });
    const running = supervisor.execute('run-1');
    await until('the session', () => sessions.started.length === 1);
    await supervisor.steer('run-1', 'Use the blue one');
    expect(sessions.started[0]?.steers).toEqual(['Use the blue one']);
    sessions.started[0]?.finish();
    await running;
    await supervisor.steer('run-1', 'Later');
    await supervisor.steer('missing', 'Nobody');
    await supervisor.cancel('run-1');
    expect(dispatched.filter((command) => command.type === 'message.deliver')).toEqual([
      { type: 'message.deliver', taskId: 'task-1', text: 'Later' },
    ]);
  });

  test('cancel stops a live session', async () => {
    const sessions = createSessions();
    const { supervisor } = setup(withTask(createTempDir()), { startSession: sessions.startSession });
    const running = supervisor.execute('run-1');
    await until('the session', () => sessions.started.length === 1);
    await supervisor.cancel('run-1');
    await running;
    expect(sessions.started[0]?.cancelled).toBe(true);
  });

  test('recovery resumes running agents, skips queued and waiting ones, and dispatches the rest', async () => {
    const sessions = createSessions();
    const worktree = createTempDir();
    const { supervisor, dispatched, reject, respond } = setup(
      (state) => {
        withTask(worktree, [
          createRun({ sessionId: 'sess-1' }),
          createRun({ id: 'run-2', status: 'queued' }),
          createRun({ id: 'run-3' }),
        ])(state);
        state.tasks['task-2'] = createTask({ id: 'task-2', worktreePath: createTempDir() });
        state.runs['run-4'] = createRun({ id: 'run-4', taskId: 'task-2' });
        state.tasks['task-3'] = createTask({ id: 'task-3', worktreePath: null });
        state.runs['run-5'] = createRun({ id: 'run-5', taskId: 'task-3' });
        state.gates['gate-1'] = createGate({ runId: 'run-3' });
      },
      { startSession: sessions.startSession }
    );
    reject((command) => command.type === 'run.end' && command.runId === 'run-5');
    continueRuns(respond, ['run-1', 'run-4', 'run-5']);
    await supervisor.recover();
    await until('two sessions', () => sessions.started.length === 2);
    expect(sessions.started.map((fake) => [fake.input.prompt.length > 0, fake.input.resume])).toEqual([
      [true, 'sess-1'],
      [true, null],
    ]);
    expect(dispatched.filter((command) => command.type === 'runs.dispatch')).toHaveLength(1);
    expect(
      dispatched
        .filter((command) => command.type === 'run.continue')
        .map((command) => command.type === 'run.continue' && command.runId)
    ).toEqual(['run-1', 'run-3', 'run-4', 'run-5']);
    for (const fake of sessions.started) fake.finish();
  });
});

describe('questions', () => {
  function createTimers() {
    const pending = new Map<number, { fire: () => void; at: number }>();
    let next = 0;
    const timers = {
      at: 0,
      now: () => timers.at,
      start: (fire: () => void, ms: number) => {
        next += 1;
        pending.set(next, { fire, at: timers.at + ms });
        return next;
      },
      clear: (timer: unknown) => {
        pending.delete(timer as number);
      },
      advance: (ms: number) => {
        timers.at += ms;
        for (const [id, timer] of [...pending]) {
          if (timer.at > timers.at) continue;
          pending.delete(id);
          timer.fire();
        }
      },
    };
    return timers;
  }

  function askingSetup(maxRunMs?: number) {
    const sessions = createSessions();
    const clockTimers = createTimers();
    const context = setup(withTask(createTempDir()), {
      startSession: sessions.startSession,
      maxRunMs,
      clockTimers,
    });
    const running = context.supervisor.execute('run-1');
    const ready = until('the session', () => sessions.started.length === 1);
    return { ...context, sessions, running, ready, clockTimers };
  }

  test('an answer reaches the waiting tool call, and overlapping questions keep the clock stopped', async () => {
    const { supervisor, sessions, running, ready, dispatched, update, clockTimers } = askingSetup(60);
    await ready;
    const { input, finish } = sessions.started[0] as FakeSession;
    const signal = new AbortController().signal;
    const first = input.tools.handle('ask', { question: 'Blue or green?' }, signal);
    const second = input.tools.handle('ask', { question: 'Tabs or spaces?', context: 'Style' }, signal);
    await until(
      'both questions',
      () => dispatched.filter((command) => command.type === 'agent.ask').length === 2
    );
    clockTimers.advance(100);
    const gateIds = dispatched.flatMap((command) => (command.type === 'agent.ask' ? [command.gateId] : []));
    update((state) => {
      state.gates[gateIds[0] ?? ''] = createGate({ id: gateIds[0], status: 'answered', response: 'Blue' });
      state.gates[gateIds[1] ?? ''] = createGate({ id: gateIds[1], status: 'withdrawn' });
    });
    await supervisor.resolveQuestion(gateIds[0] ?? '');
    await supervisor.resolveQuestion(gateIds[1] ?? '');
    expect(await first).toBe('The human answered: Blue');
    expect(await second).toBe('The question was withdrawn. Continue with your best judgement.');
    expect(sessions.started[0]?.cancelled).toBe(false);
    finish();
    await running;
  });

  test('a message that supersedes a question reaches the waiting tool call instead of an answer', async () => {
    const { supervisor, sessions, running, ready, dispatched, update } = askingSetup();
    await ready;
    const { input, finish } = sessions.started[0] as FakeSession;
    const asked = input.tools.handle('ask', { question: 'Blue or green?' }, new AbortController().signal);
    await until('the question', () => dispatched.some((command) => command.type === 'agent.ask'));
    const gateId = dispatched.flatMap((command) => (command.type === 'agent.ask' ? [command.gateId] : []))[0];
    update((state) => {
      state.gates[gateId ?? ''] = createGate({
        id: gateId,
        status: 'withdrawn',
        supersededBy: 'Use the green one, and skip the tests.',
      });
    });
    await supervisor.resolveQuestion(gateId ?? '');
    expect(await asked).toBe(
      'The question was withdrawn. The human wrote this instead: Use the green one, and skip the tests.'
    );
    finish();
    await running;
    expect(dispatched.some((command) => command.type === 'message.deliver')).toBe(false);
  });

  test('a question needs text, a stopped step cannot ask, and a refused question is not left waiting', async () => {
    const { sessions, running, ready, reject } = askingSetup();
    await ready;
    const { input, finish } = sessions.started[0] as FakeSession;
    const live = new AbortController();
    expect(input.tools.handle('ask', {}, live.signal)).rejects.toThrow('question is required.');
    const aborted = new AbortController();
    aborted.abort();
    expect(input.tools.handle('ask', { question: 'x' }, aborted.signal)).rejects.toThrow(
      'This step was stopped.'
    );
    reject((command) => command.type === 'agent.ask', new Error('gate refused'));
    expect(input.tools.handle('ask', { question: 'x' }, live.signal)).rejects.toThrow('gate refused');
    finish();
    await running;
  });

  test('a session that stops while waiting withdraws its question', async () => {
    const { sessions, running, ready, dispatched } = askingSetup();
    await ready;
    const { input, finish } = sessions.started[0] as FakeSession;
    const controller = new AbortController();
    const asked = input.tools.handle('ask', { question: 'x' }, controller.signal);
    await until('the question', () => dispatched.some((command) => command.type === 'agent.ask'));
    controller.abort();
    expect(await asked).toBe('The question was withdrawn. Continue with your best judgement.');
    finish();
    await running;
  });

  test('an answer after a restart restarts the asking step with it, or goes to the task', async () => {
    const sessions = createSessions();
    const { supervisor, dispatched } = setup(
      (state) => {
        withTask(createTempDir())(state);
        state.gates.g1 = createGate({ id: 'g1', status: 'answered', response: 'Blue' });
        state.gates.g2 = createGate({ id: 'g2', status: 'answered', response: null, runId: null });
        state.gates.g3 = createGate({ id: 'g3', status: 'withdrawn' });
        state.gates.g4 = createGate({ id: 'g4', taskId: 'task-9', status: 'answered', response: 'x' });
        state.tasks['task-8'] = createTask({ id: 'task-8', stage: 'merged' });
        state.gates.g5 = createGate({ id: 'g5', taskId: 'task-8', status: 'answered', response: 'x' });
      },
      { startSession: sessions.startSession }
    );
    const resumed = supervisor.resolveQuestion('g1');
    await until('the resumed session', () => sessions.started.length === 1);
    expect(sessions.started[0]?.input.prompt).toContain('Blue');
    sessions.started[0]?.finish();
    await resumed;
    await supervisor.resolveQuestion('g2');
    for (const id of ['g3', 'g4', 'g5', 'missing']) await supervisor.resolveQuestion(id);
    expect(dispatched.filter((command) => command.type === 'message.deliver')).toHaveLength(1);
  });

  test('a message that supersedes the question of a step that cannot resume goes to the task as written', async () => {
    const { supervisor, dispatched } = setup((state) => {
      withTask(createTempDir(), [createRun({ endedAt: 5 })])(state);
      state.gates.g1 = createGate({ id: 'g1', status: 'withdrawn', supersededBy: 'Go green.' });
    });
    await supervisor.resolveQuestion('g1');
    expect(dispatched.filter((command) => command.type === 'message.deliver')).toEqual([
      { type: 'message.deliver', taskId: 'task-1', text: 'Go green.' },
    ]);
  });
});

describe('hand-overs', () => {
  async function handOverSetup(patch?: (state: ShinsaState) => void, options: SupervisorOptions = {}) {
    const { path } = await createGitRepo({ remote: false });
    const sessions = createSessions();
    const context = setup(
      (state) => {
        withTask(path)(state);
        patch?.(state);
      },
      { startSession: sessions.startSession, ...options }
    );
    const running = context.supervisor.execute('run-1');
    await until('the session', () => sessions.started.length === 1);
    const fake = sessions.started[0] as FakeSession;
    const call = (name: string, input: Record<string, unknown> = {}) =>
      fake.input.tools.handle(name, input, new AbortController().signal);
    return { ...context, path, call, done: () => fake.finish(), running };
  }

  test('a phase is committed then handed over, a fix likewise, and a review is reported', async () => {
    const { call, path, dispatched, done, running } = await handOverSetup();
    writeFiles(path, { 'a.txt': 'a' });
    const phase = { summary: 'Wrote `a.txt`.', spots: [], judgement_calls: [] };
    expect(await call('complete_phase', phase)).toBe(
      'Handed over: the human reads it in the chat as your reply. Stop here and write nothing more: never point at it, repeat or summarise it, and never say your turn is over.'
    );
    expect(await git(path, 'log', '-1', '--format=%s')).toBe('fix: the tab scroll');
    const change = {
      action: 'add',
      label: 'Scroll',
      command: 'bun test test/scroll.test.ts',
      reason: 'New file.',
    };
    expect(
      await call('complete_fix', { summary: 'Fixed.', checks: ['c1'], check_changes: [change] })
    ).toContain('Handed over: the human reads it in the chat as your reply.');
    expect(dispatched.find((command) => command.type === 'agent.complete_fix')).toMatchObject({
      checks: ['c1'],
      checkChanges: [
        { action: 'add', id: null, label: 'Scroll', command: 'bun test test/scroll.test.ts', phases: null },
      ],
    });
    expect(
      await call('report_review', {
        summary: 'Read the change.',
        findings: [],
        disagreements: [{ call: 1, reason: 'A flag reads clearer.' }],
      })
    ).toContain('Handed over: the human reads it in the chat as your reply.');
    expect(dispatched.find((command) => command.type === 'agent.report_review')).toMatchObject({
      summary: 'Read the change.',
      findings: [],
      disagreements: [{ call: 1, reason: 'A flag reads clearer.' }],
    });
    expect(call('propose_plan', { goal: '' })).rejects.toThrow('Shinsa rejected this hand-over.');
    expect(
      await call('propose_plan', {
        goal: 'Add the files.',
        phases: [
          { title: 'Write a', detail: 'Create a.txt.' },
          { title: 'Write b', detail: 'Create b.txt.' },
        ],
        behaviour: ['Both exist.'],
        approach: 'Write them.',
        files: [],
        out_of_scope: [],
        verification: [{ label: 'Both files', command: 'test -f a.txt -a -f b.txt', phases: [1, 2] }],
        questions: [],
      })
    ).toContain('Handed over: the human reads it in the chat as your reply.');
    expect(
      dispatched
        .map((command) => command.type)
        .filter((type) => type.startsWith('agent.'))
        .slice(0, 3)
    ).toEqual(['agent.complete_phase', 'agent.complete_fix', 'agent.report_review']);
    done();
    await running;
  });

  test('evidence, notes and task lookups', async () => {
    const { call, path, dispatched, done, running } = await handOverSetup((state) => {
      Object.assign(state.tasks['task-1'] ?? {}, { activity: [], phases: [], findings: [] });
    });
    writeFiles(path, { 'shot.png': 'png' });
    expect(await call('attach_evidence', { kind: 'screenshot', title: 'Home', path: 'shot.png' })).toBe(
      'Attached.'
    );
    expect(dispatched.at(-1)).toMatchObject({
      type: 'agent.attach_evidence',
      kind: 'screenshot',
      title: 'Home',
      uri: expect.stringMatching(/^\/api\/evidence\/task-1\/round-1\/home-\w+\.png$/),
    });
    writeFiles(path, { 'after.png': 'png' });
    expect(
      await call('attach_evidence', {
        kind: 'comparison',
        title: 'Home',
        parts: [
          { path: 'shot.png', stage: 'before' },
          { path: 'after.png', stage: 'after' },
        ],
      })
    ).toBe('Attached.');
    expect(dispatched.at(-1)).toMatchObject({
      type: 'agent.attach_comparison',
      runId: expect.any(String),
      title: 'Home',
      parts: [
        { kind: 'screenshot', stage: 'before' },
        { kind: 'screenshot', stage: 'after' },
      ],
    });
    expect(await call('remove_evidence', { items: ['home'], reason: 'The page changed.' })).toBe('Removed.');
    expect(dispatched.at(-1)).toMatchObject({
      type: 'agent.remove_evidence',
      items: ['home'],
      reason: 'The page changed.',
    });
    expect(call('remove_evidence', { items: [] })).rejects.toThrow('items names no evidence.');
    expect(await call('note', { note: 'Follow up on dark mode.' })).toBe('Noted.');
    expect(call('note', {})).rejects.toThrow('note is required.');
    expect(await call('find_tasks', { query: 'tab' })).toContain('Fix the tab scroll');
    expect(await call('find_tasks')).toContain('Fix the tab scroll');
    expect(await call('read_task', { task_id: 'task-1' })).toContain('Request: Fix the tab scroll');
    expect(await call('read_task', { task_id: 'task-9' })).toBe(
      'No task task-9. `find_tasks` lists the tasks.'
    );
    expect(call('read_task')).rejects.toThrow('task_id is required.');
    expect(await call('list_repository_work')).toStartWith('No other open task works in ');
    expect(call('launch_rockets')).rejects.toThrow('Unknown tool launch_rockets.');
    done();
    await running;
  });

  test('the service tools reach the task’s own runs, and only for the roles that have them', async () => {
    const services = {
      home: '/home',
      snapshot: () => ({ terminals: [], services: [], home: '/home' }),
      startService: () => createInfo(),
      stopService: () => Promise.resolve(),
      restartService: () => Promise.resolve(createInfo()),
      readServiceOutput: () => Promise.resolve([]),
    };
    const agent = await handOverSetup(undefined, { services });
    expect(await agent.call('list_services')).toBe(
      'The project has no services. The human adds them in Shinsa under Services.'
    );
    agent.done();
    await agent.running;
    const answerer = await handOverSetup(
      (state) => {
        state.runs['run-1'] = createRun({ role: 'answerer', purpose: undefined });
      },
      { services }
    );
    expect(answerer.call('run_service', { service: 'api', action: 'start' })).rejects.toThrow(
      'You are answering: hand the answer over with `answer`.'
    );
    answerer.done();
    await answerer.running;
    const without = await handOverSetup();
    expect(without.call('list_services')).rejects.toThrow(
      'not available while Shinsa runs without terminals'
    );
    without.done();
    await without.running;
  });

  test('a hand-over core refuses leaves no commit behind, and the edits stay in the worktree', async () => {
    const { call, path, reject, done, running } = await handOverSetup();
    reject(
      (command) => command.type === 'agent.complete_phase' || command.type === 'agent.complete_fix',
      new DomainError('delegations_running', '1 task you delegated is still running.')
    );
    const before = await git(path, 'rev-parse', 'HEAD');
    writeFiles(path, { 'half-written.txt': 'partial' });
    await expect(
      call('complete_phase', { summary: 'Wrote it.', spots: [], judgement_calls: [] })
    ).rejects.toThrow('still running');
    await expect(call('complete_fix', { summary: 'Fixed.' })).rejects.toThrow('still running');
    expect(await git(path, 'rev-parse', 'HEAD')).toBe(before);
    expect(await git(path, 'status', '--porcelain')).toContain('half-written.txt');
    done();
    await running;
  });

  test('a hand-over from a run that is over or gone is refused, and a task without a worktree commits nothing', async () => {
    const { call, update, done, running } = await handOverSetup();
    update((state) => {
      state.tasks['task-1'] = createTask({ worktreePath: null });
    });
    expect(await call('complete_fix', { summary: 'Fixed.' })).toContain(
      'Handed over: the human reads it in the chat as your reply.'
    );
    update((state) => {
      state.runs['run-1'] = createRun({ endedAt: 3 });
    });
    expect(call('complete_fix', { summary: 'x' })).rejects.toThrow('This step is already over.');
    update((state) => {
      delete state.runs['run-1'];
    });
    expect(call('complete_fix', { summary: 'x' })).rejects.toThrow('This run no longer exists.');
    done();
    await running;
  });
});

test('evidence written to a directory that is gone is reported back to the agent', async () => {
  const sessions = createSessions();
  const worktree = createTempDir();
  mkdirSync(join(worktree, 'x'));
  const { supervisor } = setup(withTask(worktree), {
    startSession: sessions.startSession,
    evidenceDir: join(createTempDir(), 'gone'),
  });
  const running = supervisor.execute('run-1');
  await until('the session', () => sessions.started.length === 1);
  const fake = sessions.started[0] as FakeSession;
  expect(
    fake.input.tools.handle('attach_evidence', { text: 'log' }, new AbortController().signal)
  ).rejects.toThrow();
  fake.finish();
  await running;
});

function fakeProvider(
  id: string,
  startSession: SessionStarter,
  overrides: Partial<AgentProvider> = {}
): AgentProvider {
  return {
    id,
    label: id === 'claude' ? 'Claude' : 'Codex',
    capabilities: CLAUDE_CAPABILITIES,
    startSession,
    listModels: () => Promise.resolve([]),
    complete: () => Promise.resolve(null),
    ...overrides,
  };
}

function withSessionHistory(transcripts: Transcripts, runId = 'run-0') {
  transcripts.record(runId, { type: 'user', from: 'shinsa', text: 'Build phase 1.', attachments: [] });
  transcripts.record(runId, { type: 'agent', phase: 'final', text: 'Wrote a.ts.' });
}

describe('attempts and conditional writes', () => {
  test('each execution is an attempt: it is recorded first, and its hand-overs and end carry its id', async () => {
    const sessions = createSessions();
    const { supervisor, dispatched } = setup(withTask(createTempDir(), [createRun({ model: 'opus' })]), {
      startSession: sessions.startSession,
    });
    const running = supervisor.execute('run-1');
    await until('the session', () => sessions.started.length === 1);
    const fake = sessions.started[0] as FakeSession;
    await fake.input.tools.handle('note', { note: 'Working.' }, new AbortController().signal);
    const failure = {
      class: 'provider_error',
      message: 'Busy.',
      code: null,
      retryable: true,
      resetAt: null,
    } as const;
    fake.finish('failed', { failure, summary: 'Busy.' });
    await running;
    const attempt = dispatched[0];
    expect(attempt).toMatchObject({
      type: 'run.attempt',
      runId: 'run-1',
      provider: 'claude',
      model: 'opus',
      resumed: false,
      handoff: null,
    });
    const attemptId = attempt?.type === 'run.attempt' ? attempt.attemptId : '';
    expect(dispatched.find((command) => command.type === 'agent.note')).toMatchObject({ attemptId });
    expect<unknown>(endedRuns(dispatched)).toEqual([
      { type: 'run.end', runId: 'run-1', outcome: 'failed', summary: 'Busy.', attemptId, failure },
    ]);
  });

  test('a hand-over from an attempt that was replaced is refused before anything is committed', async () => {
    const { path } = await createGitRepo({ remote: false });
    const sessions = createSessions();
    const { supervisor, update } = setup(withTask(path), { startSession: sessions.startSession });
    const running = supervisor.execute('run-1');
    await until('the session', () => sessions.started.length === 1);
    update((state) => {
      state.runs['run-1'] = createRun({ attemptId: 'a-newer' });
    });
    writeFiles(path, { 'late.txt': 'x' });
    const fake = sessions.started[0] as FakeSession;
    expect(
      fake.input.tools.handle('complete_fix', { summary: 'x' }, new AbortController().signal)
    ).rejects.toThrow('A newer attempt of this step has taken over.');
    expect(
      fake.input.tools.handle('report_review', { findings: [] }, new AbortController().signal)
    ).rejects.toThrow('A newer attempt');
    expect(await git(path, 'status', '--porcelain')).toContain('late.txt');
    fake.finish();
    await running;
  });
});

describe('provider capabilities', () => {
  test('a provider that cannot block forbidden commands is never started', async () => {
    const sessions = createSessions();
    const { supervisor, dispatched } = setup(withTask(createTempDir()), {
      providers: new ProviderRegistry([
        fakeProvider('claude', sessions.startSession, { capabilities: undefined }),
      ]),
    });
    await supervisor.execute('run-1');
    expect(sessions.started).toHaveLength(0);
    expect(endedRuns(dispatched)[0]).toMatchObject({
      outcome: 'failed',
      failure: { class: 'setup_failed', code: 'unguarded' },
    });
  });

  test('a provider that cannot take a message mid-turn gets it as the next turn', async () => {
    const sessions = createSessions();
    const capabilities = { ...CLAUDE_CAPABILITIES, turns: { ...CLAUDE_CAPABILITIES.turns, steering: false } };
    const { supervisor, dispatched } = setup(withTask(createTempDir()), {
      providers: new ProviderRegistry([fakeProvider('claude', sessions.startSession, { capabilities })]),
    });
    const running = supervisor.execute('run-1');
    await until('the session', () => sessions.started.length === 1);
    await supervisor.steer('run-1', 'Use blue');
    expect(sessions.started[0]?.steers).toEqual([]);
    expect(dispatched.at(-1)).toEqual({ type: 'message.deliver', taskId: 'task-1', text: 'Use blue' });
    sessions.started[0]?.finish();
    await running;
  });
});

describe('resume fallback', () => {
  function restoreSetup(
    patch: (state: ShinsaState) => void,
    providerOverrides: Partial<AgentProvider> = {},
    defaultProvider = 'claude',
    options: SupervisorOptions = {}
  ) {
    const sessions = createSessions();
    const providers = new ProviderRegistry([
      fakeProvider('claude', sessions.startSession, providerOverrides),
      fakeProvider('codex', sessions.startSession),
    ]);
    const context = setup(
      (state) => {
        withTask(createTempDir(), [
          createRun({ id: 'run-0', endedAt: 1, sessionId: 'old' }),
          createRun({ sessionId: 'old' }),
        ])(state);
        state.settings.defaultProvider = defaultProvider;
        patch(state);
      },
      { providers, ...options }
    );
    withSessionHistory(context.transcripts);
    return { ...context, sessions };
  }

  async function runOnce(
    context: ReturnType<typeof restoreSetup>,
    finish: (fake: FakeSession) => void = (fake) => fake.finish()
  ) {
    const running = context.supervisor.execute('run-1', 'Carry on.');
    await until('the session', () => context.sessions.started.length > 0);
    finish(context.sessions.started[0] as FakeSession);
    await running;
  }

  test('a session whose file is gone is marked lost and the step starts fresh with the conversation handed over', async () => {
    for (const status of ['missing', 'empty'] as const) {
      const context = restoreSetup(() => undefined, { inspectSession: () => Promise.resolve(status) });
      await runOnce(context);
      const input = context.sessions.started[0]?.input;
      expect(input?.resume).toBeNull();
      expect(input?.prompt).toStartWith(
        '<system-message>\nYour previous session for this step could not be resumed'
      );
      expect(input?.prompt).toContain('--- shinsa ---\nBuild phase 1.');
      expect(input?.prompt).toContain('--- agent ---\nWrote a.ts.');
      expect(input?.prompt).toEndWith('Carry on.');
      expect(context.dispatched[0]).toEqual({
        type: 'run.record_lost_session',
        runId: 'run-1',
        sessionId: 'old',
      });
      expect(context.commandIds[0]).toBe('run.record_lost_session:run-1:old');
      expect(context.dispatched[1]).toMatchObject({
        type: 'run.attempt',
        resumed: false,
        handoff: { reason: 'session_restore', fromProvider: 'claude', totalEntries: 2, includedEntries: 2 },
      });
      expect(context.transcripts.listEntries('run-1')).toContainEqual(
        expect.objectContaining({
          type: 'notice',
          notice: expect.objectContaining({
            kind: 'handoff',
            reason: 'session_restore',
            fromProvider: 'Claude',
            toProvider: 'Claude',
          }),
        })
      );
    }
  });

  test('a session that is still there is resumed, and one the provider cannot check is resumed too', async () => {
    const present = restoreSetup(() => undefined, { inspectSession: () => Promise.resolve('present') });
    await runOnce(present);
    expect(present.sessions.started[0]?.input).toMatchObject({ resume: 'old', prompt: 'Carry on.' });
    const unchecked = restoreSetup(() => undefined, { inspectSession: undefined });
    await runOnce(unchecked);
    expect(unchecked.sessions.started[0]?.input.resume).toBe('old');
  });

  test('a session known to be lost, or a provider without sessions, is never resumed', async () => {
    let checked = 0;
    const lost = restoreSetup(
      (state) => {
        state.runs['run-1'] = createRun({ sessionId: 'old', sessionLost: true });
      },
      {
        inspectSession: () => {
          checked += 1;
          return Promise.resolve('present');
        },
      }
    );
    await runOnce(lost);
    expect(lost.sessions.started[0]?.input.resume).toBeNull();
    expect(checked).toBe(0);
    const sessionless = restoreSetup(() => undefined, {
      capabilities: { ...CLAUDE_CAPABILITIES, sessions: { resume: false, inspect: false } },
    });
    await runOnce(sessionless);
    expect(sessionless.sessions.started[0]?.input.prompt).toContain('<handoff_transcript>');
  });

  test('switching provider mid-run hands the conversation to the new one instead of resuming the old session', async () => {
    const context = restoreSetup(() => undefined, {}, 'codex');
    await runOnce(context);
    const input = context.sessions.started[0]?.input;
    expect(input?.resume).toBeNull();
    expect(input?.prompt).toContain('This step is being handed to you from another coding agent (Claude).');
    expect(context.dispatched[0]).toMatchObject({
      type: 'run.attempt',
      provider: 'codex',
      handoff: { reason: 'provider_switch', fromProvider: 'claude' },
    });
    expect(context.transcripts.listEntries('run-1')).toContainEqual(
      expect.objectContaining({
        notice: expect.objectContaining({ kind: 'handoff', fromProvider: 'Claude', toProvider: 'Codex' }),
      })
    );
  });

  test('a role moved to another provider is handed over and runs on that provider’s model for the role', async () => {
    const context = restoreSetup((state) => {
      state.settings.agentProviders = { agent: 'codex' };
    });
    await runOnce(context);
    expect(context.sessions.started[0]?.input).toMatchObject({ resume: null, model: 'gpt-6-astra' });
    expect(context.dispatched[0]).toMatchObject({
      type: 'run.attempt',
      provider: 'codex',
      model: 'gpt-6-astra',
      handoff: { reason: 'provider_switch', fromProvider: 'claude' },
    });
  });

  test('a provider without a context handoff, or a history with nothing to hand over, starts plainly fresh', async () => {
    const plain = restoreSetup(() => undefined, {
      capabilities: {
        ...CLAUDE_CAPABILITIES,
        sessions: { resume: false, inspect: false },
        contextHandoff: false,
      },
    });
    await runOnce(plain);
    expect(plain.sessions.started[0]?.input).toMatchObject({ resume: null, prompt: 'Carry on.' });
    const empty = restoreSetup((state) => {
      state.runs['run-1'] = createRun({ sessionId: 'unknown-history', sessionLost: true });
    });
    await runOnce(empty);
    expect(empty.sessions.started[0]?.input).toMatchObject({ resume: null, prompt: 'Carry on.' });
  });

  describe('the house rules', () => {
    const rules = resolveHouseRules('answerer');
    const brief = (text: string) => `${rules}\n\nYour role: answerer. ${text}`;

    function briefedSetup(provider: 'claude' | 'codex', history: (transcripts: Transcripts) => void) {
      const context = restoreSetup(
        (state) => {
          for (const run of Object.values(state.runs)) Object.assign(run, { role: 'answerer', provider });
        },
        { inspectSession: () => Promise.resolve('present') },
        provider
      );
      history(context.transcripts);
      return context;
    }

    function recordBrief(fake: FakeSession) {
      fake.input.onEntry({ type: 'user', from: 'shinsa', text: fake.input.prompt, attachments: [] });
      fake.finish();
    }

    async function send(context: ReturnType<typeof briefedSetup>, runId: string, text: string) {
      const count = context.sessions.started.length;
      const running = context.supervisor.execute(runId, brief(text));
      await until('the session', () => context.sessions.started.length > count);
      const fake = context.sessions.started[count] as FakeSession;
      recordBrief(fake);
      await running;
      return fake.input;
    }

    function briefedWith(text: string) {
      return (transcripts: Transcripts) => {
        transcripts.record('run-0', { type: 'user', from: 'shinsa', text, attachments: [] });
        transcripts.record('run-0', { type: 'agent', phase: 'final', text: 'Answered.' });
      };
    }

    test('a resumed session that has them gets only the new instruction, on Claude and on Codex, turn after turn', async () => {
      for (const provider of ['claude', 'codex'] as const) {
        const context = briefedSetup(provider, briefedWith(brief('The question: why?')));
        const second = await send(context, 'run-1', 'The follow-up: and then?');
        expect(second).toMatchObject({
          resume: 'old',
          prompt: 'Your role: answerer. The follow-up: and then?',
        });
        context.state.runs['run-2'] = createRun({
          id: 'run-2',
          role: 'answerer',
          provider,
          sessionId: 'old',
          startedAt: 2,
        });
        const third = await send(context, 'run-2', 'The follow-up: one more?');
        expect(third.prompt).toBe('Your role: answerer. The follow-up: one more?');
        expect(rules.length).toBeGreaterThan(5_000);
      }
    });

    test('a session that never had these rules, or lost them to a compaction, gets the full brief', async () => {
      const builder = briefedSetup(
        'claude',
        briefedWith(`${resolveHouseRules('builder')}\n\nBuild phase 1.`)
      );
      expect((await send(builder, 'run-1', 'The follow-up: why?')).prompt).toBe(brief('The follow-up: why?'));
      const compacted = briefedSetup('codex', (transcripts) => {
        briefedWith(brief('The question: why?'))(transcripts);
        transcripts.record('run-0', {
          type: 'notice',
          notice: { kind: 'compaction', trigger: 'auto', preTokens: 180_000, summary: null },
        });
      });
      expect((await send(compacted, 'run-1', 'The follow-up: why?')).prompt).toBe(
        brief('The follow-up: why?')
      );
      const unknown = briefedSetup('claude', () => undefined);
      expect((await send(unknown, 'run-1', 'The follow-up: why?')).prompt).toBe(brief('The follow-up: why?'));
    });

    test('a fresh session, a provider switch or a lost session gets the full brief', async () => {
      const fresh = briefedSetup('claude', briefedWith(brief('The question: why?')));
      fresh.state.runs['run-1'] = createRun({ role: 'answerer', sessionId: null });
      expect((await send(fresh, 'run-1', 'Why?')).prompt).toBe(brief('Why?'));
      const lost = restoreSetup(() => undefined, { inspectSession: () => Promise.resolve('missing') });
      briefedWith(brief('The question: why?'))(lost.transcripts);
      const running = lost.supervisor.execute('run-1', brief('Why?'));
      await until('the session', () => lost.sessions.started.length > 0);
      const input = (lost.sessions.started[0] as FakeSession).input;
      expect(input.resume).toBeNull();
      expect(input.prompt).toEndWith(brief('Why?'));
      lost.sessions.started[0]?.finish();
      await running;
      const switched = restoreSetup(() => undefined, {}, 'codex');
      briefedWith(brief('The question: why?'))(switched.transcripts);
      await runOnce(switched);
      expect(switched.sessions.started[0]?.input.prompt).toContain('This step is being handed to you');
    });
  });

  test('a resume the CLI refuses is retried once on a fresh session with the history', async () => {
    const context = restoreSetup(() => undefined, { inspectSession: () => Promise.resolve('present') });
    const lost = {
      class: 'session_lost',
      message: 'gone',
      code: 'unknown_session',
      retryable: null,
      resetAt: null,
    } as const;
    const running = context.supervisor.execute('run-1', 'Carry on.');
    await until('the first session', () => context.sessions.started.length === 1);
    context.sessions.started[0]?.finish('failed', { failure: lost });
    await until('the second session', () => context.sessions.started.length === 2);
    const second = context.sessions.started[1] as FakeSession;
    expect(second.input.resume).toBeNull();
    expect(second.input.prompt).toContain('<handoff_transcript>');
    second.finish('failed', { failure: lost });
    await running;
    expect(context.sessions.started).toHaveLength(2);
    expect(context.dispatched.filter((command) => command.type === 'run.record_lost_session')).toHaveLength(
      1
    );
    expect(endedRuns(context.dispatched)[0]).toMatchObject({
      outcome: 'failed',
      failure: { class: 'session_lost' },
    });
  });

  test('a session lost on a later attempt, after the turn moved, is also restored with the history', async () => {
    const context = restoreSetup(
      () => undefined,
      { inspectSession: () => Promise.resolve('present') },
      'claude',
      { onRejection: (rejection) => ({ retry: rejection.failure.class === 'usage_limit' }) }
    );
    const running = context.supervisor.execute('run-1', 'Carry on.');
    await until('the first session', () => context.sessions.started.length === 1);
    context.sessions.started[0]?.finish('failed', {
      failure: { class: 'usage_limit', message: 'Limit.', code: 'rate_limit', retryable: true, resetAt: 9 },
    });
    await until('the second session', () => context.sessions.started.length === 2);
    expect(context.sessions.started[1]?.input.resume).toBe('old');
    context.sessions.started[1]?.finish('failed', {
      failure: {
        class: 'session_lost',
        message: 'gone',
        code: 'unknown_session',
        retryable: null,
        resetAt: null,
      },
    });
    await until('the third session', () => context.sessions.started.length === 3);
    const third = context.sessions.started[2] as FakeSession;
    expect(third.input.resume).toBeNull();
    expect(third.input.prompt).toContain('<handoff_transcript>');
    third.finish();
    await running;
    expect(context.dispatched.filter((command) => command.type === 'run.record_lost_session')).toHaveLength(
      1
    );
    expect(context.commandIds).toContain('run.record_lost_session:run-1:old');
  });

  test('a history too large to hand over fails the step as a full context instead of dropping it silently', async () => {
    const context = restoreSetup(() => undefined, { inspectSession: () => Promise.resolve('missing') });
    context.transcripts.record('run-0', { type: 'agent', phase: 'final', text: 'x'.repeat(450_000) });
    await supervisorRuns(context);
    expect(context.sessions.started).toHaveLength(0);
    expect(endedRuns(context.dispatched)[0]).toMatchObject({
      outcome: 'failed',
      failure: { class: 'context_window_full', code: 'handoff_too_large' },
    });
  });

  async function supervisorRuns(context: ReturnType<typeof restoreSetup>) {
    await context.supervisor.execute('run-1', 'Carry on.');
  }
});

describe('the rejection seam', () => {
  const limit = {
    class: 'usage_limit',
    message: 'Limit.',
    code: 'rate_limit',
    retryable: true,
    resetAt: 9,
  } as const;

  test('a classified failure is offered to the handler, which can retry the same turn as a new attempt', async () => {
    const sessions = createSessions();
    const rejections: RunRejection[] = [];
    const { supervisor, dispatched } = setup(withTask(createTempDir()), {
      startSession: sessions.startSession,
      onRejection: (rejection) => {
        rejections.push(rejection);
        return { retry: rejections.length < 2 };
      },
    });
    const running = supervisor.execute('run-1');
    await until('the first session', () => sessions.started.length === 1);
    sessions.started[0]?.finish('failed', { failure: limit });
    await until('the retry', () => sessions.started.length === 2);
    sessions.started[1]?.finish('failed', { failure: limit });
    await running;
    expect(rejections).toHaveLength(2);
    expect(rejections[0]).toMatchObject({
      runId: 'run-1',
      taskId: 'task-1',
      provider: 'claude',
      accountId: null,
      tried: [],
      failure: limit,
    });
    const attempts = dispatched.flatMap((command) =>
      command.type === 'run.attempt' ? [command.attemptId] : []
    );
    expect(attempts).toHaveLength(2);
    expect(rejections[1]?.attemptId).toBe(attempts[1] as string);
    expect(endedRuns(dispatched)).toEqual([
      expect.objectContaining({ attemptId: attempts[1], failure: limit }),
    ]);
  });

  test('the handler alone decides when retries stop, a throwing handler ends the run, and a stopped run is not offered', async () => {
    const always = createSessions();
    let asked = 0;
    const counted = setup(withTask(createTempDir()), {
      startSession: always.startSession,
      onRejection: () => {
        asked += 1;
        return { retry: asked < 5 };
      },
    });
    const running = counted.supervisor.execute('run-1');
    for (let index = 0; index < 5; index += 1) {
      await until(`attempt ${index + 1}`, () => always.started.length === index + 1);
      always.started[index]?.finish('failed', { failure: limit });
    }
    await running;
    expect(always.started).toHaveLength(5);

    const broken = createSessions();
    const throwing = setup(withTask(createTempDir()), {
      startSession: broken.startSession,
      onRejection: () => {
        throw new Error('rotation broke');
      },
    });
    const failing = throwing.supervisor.execute('run-1');
    await until('the session', () => broken.started.length === 1);
    broken.started[0]?.finish('failed', { failure: limit });
    await failing;
    expect(endedRuns(throwing.dispatched)).toHaveLength(1);

    let offered = 0;
    const stopped = createSessions();
    const cancelling = setup(withTask(createTempDir()), {
      startSession: stopped.startSession,
      onRejection: () => {
        offered += 1;
        return { retry: true };
      },
    });
    const cancelled = cancelling.supervisor.execute('run-1');
    await until('the session', () => stopped.started.length === 1);
    await cancelling.supervisor.cancel('run-1');
    await cancelled;
    const plain = createSessions();
    const unclassified = setup(withTask(createTempDir()), {
      startSession: plain.startSession,
      onRejection: () => {
        offered += 1;
        return { retry: true };
      },
    });
    const ending = unclassified.supervisor.execute('run-1');
    await until('the session', () => plain.started.length === 1);
    plain.started[0]?.finish('failed');
    await ending;
    expect(offered).toBe(0);
  });

  test('messages a retried attempt never answered are steered into the next attempt', async () => {
    const sessions = createSessions();
    let offered = 0;
    const { supervisor, dispatched } = setup(withTask(createTempDir()), {
      startSession: sessions.startSession,
      onRejection: () => {
        offered += 1;
        return { retry: offered === 1 };
      },
    });
    const running = supervisor.execute('run-1');
    await until('the first attempt', () => sessions.started.length === 1);
    await supervisor.steer('run-1', 'Use the blue button.');
    sessions.started[0]?.finish('failed', { failure: limit, undelivered: ['Use the blue button.'] });
    await until('the retry', () => sessions.started.length === 2);
    expect(sessions.started[1]?.steers).toEqual(['Use the blue button.']);
    sessions.started[1]?.finish('completed', { undelivered: ['Use the blue button.'] });
    await running;
    expect(
      dispatched.flatMap((command) => (command.type === 'message.deliver' ? [command.text] : []))
    ).toEqual(['Use the blue button.']);
  });

  test('notices from the session reach the listener', async () => {
    const sessions = createSessions();
    const heard: string[] = [];
    const { supervisor } = setup(withTask(createTempDir()), {
      startSession: sessions.startSession,
      onNotice: (runId, notice) => heard.push(`${runId}:${notice.kind}`),
    });
    const running = supervisor.execute('run-1');
    await until('the session', () => sessions.started.length === 1);
    const input = sessions.started[0]?.input;
    input?.onEntry({
      type: 'notice',
      notice: {
        kind: 'rate_limit',
        status: 'rejected',
        limit: 'five_hour',
        resetsAt: null,
        utilization: null,
      },
    });
    input?.onEntry({ type: 'agent', phase: 'final', text: 'hi' });
    sessions.started[0]?.finish();
    await running;
    expect(heard).toEqual(['run-1:rate_limit']);
  });
});

describe('an overloaded provider', () => {
  const overloaded = {
    class: 'overloaded',
    message: 'Claude’s API is overloaded (529).',
    code: 'api_error_529',
    retryable: true,
    resetAt: null,
  } as const;

  function listRetries(transcripts: Transcripts) {
    return transcripts
      .listEntries('run-1')
      .flatMap((entry) =>
        entry.type === 'notice' && entry.notice.kind === 'retrying' ? [entry.notice] : []
      );
  }

  test('is tried again after a short wait, each wait in the chat, and never offered as a rejection', async () => {
    const sessions = createSessions();
    const rejections: RunRejection[] = [];
    const { supervisor, dispatched, transcripts } = setup(withTask(createTempDir()), {
      startSession: sessions.startSession,
      onRejection: (rejection) => {
        rejections.push(rejection);
        return { retry: false };
      },
    });
    const running = supervisor.execute('run-1');
    for (const count of [1, 2]) {
      await until('a session', () => sessions.started.length === count);
      sessions.started[count - 1]?.finish('failed', { failure: overloaded, summary: overloaded.message });
    }
    await until('the third session', () => sessions.started.length === 3);
    sessions.started[2]?.finish('completed');
    await running;
    expect(rejections).toEqual([]);
    expect(listRetries(transcripts)).toEqual([
      expect.objectContaining({ provider: 'claude', detail: overloaded.message, attempt: 1, attempts: 3 }),
      expect.objectContaining({ attempt: 2, attempts: 3 }),
    ]);
    expect(endedRuns(dispatched)).toEqual([expect.objectContaining({ outcome: 'completed' })]);
  });

  test('ends the run as overloaded once the retries are spent, for core to resume or pause it', async () => {
    const sessions = createSessions();
    const { supervisor, dispatched, transcripts } = setup(withTask(createTempDir()), {
      startSession: sessions.startSession,
    });
    const running = supervisor.execute('run-1');
    for (const count of [1, 2, 3, 4]) {
      await until('a session', () => sessions.started.length === count);
      sessions.started[count - 1]?.finish('failed', { failure: overloaded, summary: overloaded.message });
    }
    await running;
    expect(listRetries(transcripts).map((notice) => notice.attempt)).toEqual([1, 2, 3]);
    expect(endedRuns(dispatched)).toEqual([
      expect.objectContaining({ outcome: 'failed', failure: overloaded }),
    ]);
  });

  test('a cancel or a restart during the wait ends it at once, and its time limit still holds', async () => {
    for (const stop of ['cancel', 'shutdown'] as const) {
      const sessions = createSessions();
      const context = setup(withTask(createTempDir()), { startSession: sessions.startSession });
      context.config.overloadRetryMs = 60 * 60_000;
      const running = context.supervisor.execute('run-1');
      await until('the session', () => sessions.started.length === 1);
      sessions.started[0]?.finish('failed', { failure: overloaded });
      await until('the wait', () => listRetries(context.transcripts).length === 1);
      if (stop === 'cancel') await context.supervisor.cancel('run-1');
      else await context.supervisor.interruptForShutdown();
      await running;
      expect(sessions.started).toHaveLength(1);
      expect(endedRuns(context.dispatched)).toEqual(
        stop === 'cancel' ? [expect.objectContaining({ outcome: 'cancelled' })] : []
      );
    }
    const sessions = createSessions();
    const timed = setup(withTask(createTempDir()), { startSession: sessions.startSession, maxRunMs: 200 });
    timed.config.overloadRetryMs = 60 * 60_000;
    const running = timed.supervisor.execute('run-1');
    await until('the session', () => sessions.started.length === 1);
    sessions.started[0]?.finish('failed', { failure: overloaded });
    await running;
    expect(endedRuns(timed.dispatched)).toEqual([
      expect.objectContaining({
        outcome: 'failed',
        summary: 'It ran past its time limit without handing over.',
      }),
    ]);
  });
});

describe('steering windows', () => {
  test('a message sent before the session started is steered in once it starts', async () => {
    const sessions = createSessions();
    const { supervisor, dispatched } = setup(
      withTask(createTempDir(), [createRun(), createRun({ id: 'run-2' })]),
      {
        startSession: sessions.startSession,
      }
    );
    const first = supervisor.execute('run-1');
    await until('the first session', () => sessions.started.length === 1);
    const second = supervisor.execute('run-2');
    await supervisor.steer('run-2', 'Queued while waiting');
    sessions.started[0]?.finish();
    await until('the second session', () => sessions.started.length === 2);
    expect(sessions.started[1]?.steers).toEqual(['Queued while waiting']);
    sessions.started[1]?.finish();
    await Promise.all([first, second]);
    expect(dispatched.filter((command) => command.type === 'message.deliver')).toEqual([]);
  });

  test('a note from Shinsa reaches the agent as Shinsa’s, before the session starts or during it', async () => {
    const sessions = createSessions();
    const { supervisor } = setup(withTask(createTempDir(), [createRun(), createRun({ id: 'run-2' })]), {
      startSession: sessions.startSession,
    });
    const first = supervisor.execute('run-1');
    await until('the first session', () => sessions.started.length === 1);
    await supervisor.steer('run-1', 'Another task changes a.ts.', undefined, 'shinsa');
    const second = supervisor.execute('run-2');
    await supervisor.steer('run-2', 'Queued note.', undefined, 'shinsa');
    sessions.started[0]?.finish();
    await until('the second session', () => sessions.started.length === 2);
    expect(sessions.started[0]?.steers).toEqual(['shinsa: Another task changes a.ts.']);
    expect(sessions.started[1]?.steers).toEqual(['shinsa: Queued note.']);
    sessions.started[1]?.finish();
    await Promise.all([first, second]);
  });

  test('a queued message the session will not take, and steers it never answered, come back as the next turn', async () => {
    const sessions = createSessions({ refuseSteer: true });
    const { supervisor, dispatched } = setup(
      withTask(createTempDir(), [createRun(), createRun({ id: 'run-2' })]),
      {
        startSession: sessions.startSession,
      }
    );
    const first = supervisor.execute('run-1');
    await until('the first session', () => sessions.started.length === 1);
    const second = supervisor.execute('run-2');
    await supervisor.steer('run-2', 'Refused');
    sessions.started[0]?.finish();
    await until('the second session', () => sessions.started.length === 2);
    sessions.started[1]?.finish('completed', { undelivered: ['Never answered'] });
    await Promise.all([first, second]);
    const delivered = dispatched.filter((command) => command.type === 'message.deliver');
    expect(delivered.map((command) => command.type === 'message.deliver' && command.text)).toEqual([
      'Refused',
      'Never answered',
    ]);
    const end = dispatched.findIndex((command) => command.type === 'run.end' && command.runId === 'run-2');
    expect(dispatched.findIndex((command) => command.type === 'message.deliver')).toBeGreaterThan(end);
  });

  test('a message during the stop window goes to the next turn instead of the dying session', async () => {
    const sessions = createSessions();
    const { supervisor, dispatched, update } = setup(withTask(createTempDir()), {
      startSession: sessions.startSession,
    });
    const running = supervisor.execute('run-1');
    await until('the session', () => sessions.started.length === 1);
    update((state) => {
      state.runs['run-1'] = createRun({ endedAt: 9 });
    });
    await supervisor.steer('run-1', 'Too late');
    expect(sessions.started[0]?.steers).toEqual([]);
    update((state) => {
      state.runs['run-1'] = createRun();
    });
    await supervisor.cancel('run-1');
    await supervisor.steer('run-1', 'Stopping');
    await running;
    expect(
      dispatched
        .filter((command) => command.type === 'message.deliver')
        .map((command) => command.type === 'message.deliver' && command.text)
    ).toEqual(['Too late', 'Stopping']);
  });
});

describe('shutdown and restart continuation', () => {
  test('shutdown marks every live run, stops its agent and leaves the run open for the next boot', async () => {
    const sessions = createSessions();
    const { supervisor, dispatched, reject } = setup(
      withTask(createTempDir(), [createRun(), createRun({ id: 'run-2', taskId: 'task-2' })]),
      { startSession: sessions.startSession }
    );
    const running = supervisor.execute('run-1');
    await until('the session', () => sessions.started.length === 1);
    const attempt = dispatched.find((command) => command.type === 'run.attempt');
    reject((command) => command.type === 'run.interrupt' && command.runId === 'nope');
    await supervisor.interruptForShutdown();
    await running;
    expect(sessions.started[0]?.cancelled).toBe(true);
    expect(dispatched.filter((command) => command.type === 'run.interrupt')).toEqual([
      {
        type: 'run.interrupt',
        runId: 'run-1',
        attemptId: attempt?.type === 'run.attempt' ? attempt.attemptId : null,
      },
    ]);
    expect(endedRuns(dispatched)).toEqual([]);
    await supervisor.execute('run-2');
    expect(sessions.started).toHaveLength(1);
  });

  test('a mark that cannot be written is logged, and messages left unsent are reported', async () => {
    const sessions = createSessions();
    const { supervisor, reject } = setup(withTask(createTempDir()), { startSession: sessions.startSession });
    reject((command) => command.type === 'run.interrupt', new Error('engine stopped'));
    const running = supervisor.execute('run-1');
    await until('the session', () => sessions.started.length === 1);
    const stopping = supervisor.interruptForShutdown();
    await stopping;
    await running;
    expect(sessions.started[0]?.cancelled).toBe(true);

    const leftover = createSessions();
    const second = setup(withTask(createTempDir()), { startSession: leftover.startSession });
    const executing = second.supervisor.execute('run-1');
    await until('the session', () => leftover.started.length === 1);
    leftover.started[0]?.finish('completed', { undelivered: ['Lost'] });
    const shutdown = second.supervisor.interruptForShutdown();
    await Promise.all([shutdown, executing]);
    expect(second.dispatched.filter((command) => command.type === 'message.deliver')).toEqual([]);
  });

  test('only a run that really ran gets the carry-on prompt; one that never started gets its own prompt', async () => {
    const sessions = createSessions();
    const attempt = {
      attemptId: 'a1',
      provider: 'claude',
      model: null,
      resumed: false,
      handoff: null,
      startedAt: 1,
    };
    const { supervisor, respond } = setup(
      (state) => {
        withTask(createTempDir(), [createRun({ sessionId: 'sess-1', attempts: [attempt] })])(state);
        state.tasks['task-2'] = createTask({ id: 'task-2', worktreePath: createTempDir() });
        state.runs['run-2'] = createRun({
          id: 'run-2',
          taskId: 'task-2',
          purpose: 'fix',
          sessionId: 'sess-0',
          prompt: 'Fix the checks.',
        });
      },
      { startSession: sessions.startSession }
    );
    continueRuns(respond, ['run-1', 'run-2']);
    await supervisor.recover();
    await until('both sessions', () => sessions.started.length === 2);
    const prompts = sessions.started.map((fake) => fake.input.prompt);
    expect(prompts).toHaveLength(2);
    expect(prompts).toEqual(
      expect.arrayContaining([
        'Fix the checks.',
        expect.stringContaining('Shinsa restarted while you were working'),
      ])
    );
    for (const fake of sessions.started) fake.finish();
  });

  test('boot continues a run only when core says so, and a failed decision is logged and skipped', async () => {
    const sessions = createSessions();
    const { supervisor, reject } = setup(
      withTask(createTempDir(), [
        createRun({ sessionId: 'sess-1' }),
        createRun({ id: 'run-2', startedAt: 0 }),
      ]),
      { startSession: sessions.startSession }
    );
    reject((command) => command.type === 'run.continue' && command.runId === 'run-2', new Error('log full'));
    await supervisor.recover();
    expect(sessions.started).toHaveLength(0);
  });
});

describe('the process tools and what a run cost', () => {
  test('an answerer runs in the repository itself, read-only, with no worktree needed', async () => {
    const sessions = createSessions();
    const repoPath = createTempDir();
    const { supervisor, dispatched } = setup(
      (state) => {
        state.repos['repo-1'] = createRepo({ path: repoPath });
        state.tasks['task-1'] = createTask({ worktreePath: null, mode: 'ask', branch: null });
        state.runs['run-1'] = createRun({ role: 'answerer' });
      },
      { startSession: sessions.startSession }
    );
    const running = supervisor.execute('run-1');
    await until('the session', () => sessions.started.length === 1);
    const fake = sessions.started[0] as FakeSession;
    expect(fake.input).toMatchObject({ role: 'answerer', cwd: repoPath });
    const call = (name: string, input: Record<string, unknown>) =>
      fake.input.tools.handle(name, input, new AbortController().signal);
    expect(await call('answer', { answer: 'In `a.ts`.' })).toBe(
      'Handed over: the human reads it in the chat as your reply. Stop here and write nothing more: never point at it, repeat or summarise it, and never say your turn is over.'
    );
    expect(call('summon', {})).rejects.toThrow('Unknown tool summon.');
    fake.finish();
    await running;
    expect(dispatched.find((command) => command.type === 'agent.deliver')).toMatchObject({
      runId: 'run-1',
      step: 'answer',
      body: 'In `a.ts`.',
    });
  });

  test('an answerer with no repository runs read-only in a scratch folder of its own, never a worktree', async () => {
    const sessions = createSessions();
    const { supervisor, config, dispatched } = setup(
      (state) => {
        state.tasks['task-1'] = createTask({ repoId: null, worktreePath: null, mode: 'ask', branch: null });
        state.runs['run-1'] = createRun({ role: 'answerer' });
      },
      { startSession: sessions.startSession }
    );
    const running = supervisor.execute('run-1');
    await until('the session', () => sessions.started.length === 1);
    const fake = sessions.started[0] as FakeSession;
    const scratch = join(config.dataDir, 'scratch', 'task-1');
    expect(fake.input).toMatchObject({ role: 'answerer', cwd: scratch, defaultBranch: 'main' });
    expect(existsSync(scratch)).toBe(true);
    fake.finish();
    await running;
    expect(endedRuns(dispatched)).toEqual([
      expect.objectContaining({ runId: 'run-1', outcome: 'completed' }),
    ]);
  });

  test('a task whose repository is gone has nowhere to run', async () => {
    const sessions = createSessions();
    const { supervisor, dispatched } = setup(
      (state) => {
        state.tasks['task-1'] = createTask({ repoId: 'gone', worktreePath: null, branch: null });
        state.runs['run-1'] = createRun({ role: 'answerer' });
      },
      { startSession: sessions.startSession }
    );
    await supervisor.execute('run-1');
    expect(sessions.started).toHaveLength(0);
    expect(endedRuns(dispatched)).toEqual([
      expect.objectContaining({
        runId: 'run-1',
        outcome: 'failed',
        summary: 'The task has no worktree to run in.',
      }),
    ]);
  });

  test('every task agent also gets the surface tools; a delegated run and a server without an address do not', async () => {
    const listNames = async (input: AgentSessionInput) => {
      const server = input.tools.createServer() as unknown as {
        _requestHandlers: Map<string, (request: unknown) => Promise<{ tools: { name: string }[] }>>;
      };
      const listed = await server._requestHandlers.get('tools/list')?.({ method: 'tools/list', params: {} });
      return listed?.tools.map((tool) => tool.name) ?? [];
    };
    const runs = [
      createRun({ role: 'answerer' }),
      createRun({
        id: 'run-2',
        role: 'answerer',
        delegation: {
          parentRunId: 'run-1',
          depth: 1,
          requestKey: 'k',
          title: 'Look',
          brief: 'Look.',
          mode: 'async',
          wake: 'always',
          isolation: 'shared',
          baseCommit: null,
          delivery: 'none',
          question: null,
          requestedAt: 1,
        },
      }),
    ];
    const patch = (state: ShinsaState) => {
      state.repos['repo-1'] = createRepo({ path: createTempDir() });
      state.tasks['task-1'] = createTask({ worktreePath: null, mode: 'ask', branch: null });
      for (const run of runs) state.runs[run.id] = run;
    };
    const sessions = createSessions();
    const unused = () => Promise.reject(new Error('Not in this test.'));
    const manage = {
      baseUrl: () => 'http://x',
      projects: { upsertRepo: unused, upsertFolder: unused },
      route: () => Promise.resolve([]),
    };
    const { supervisor } = setup(patch, { startSession: sessions.startSession, manage });
    const running = [supervisor.execute('run-1'), supervisor.execute('run-2')];
    await until('the sessions', () => sessions.started.length === 2);
    const named = await Promise.all(
      sessions.started.map(async (session) => ({ session, names: await listNames(session.input) }))
    );
    const own = named.find((entry) => entry.names.includes('answer'));
    const delegated = named.find((entry) => entry !== own);
    expect(own?.names).toEqual(expect.arrayContaining(['answer', 'tasks_list', 'create_task']));
    for (const missing of ['merges_approve', 'questions_answer', 'tasks_create'])
      expect(own?.names).not.toContain(missing);
    expect(delegated?.names).not.toContain('tasks_list');
    expect(
      delegated?.session.input.tools.handle('tasks_list', {}, new AbortController().signal)
    ).rejects.toThrow('tasks_list is not available to this agent.');
    for (const fake of sessions.started) fake.finish();
    await Promise.all(running);

    const plain = createSessions();
    const unaddressed = setup(patch, { startSession: plain.startSession });
    const unaddressedRun = unaddressed.supervisor.execute('run-1');
    await until('the session', () => plain.started.length === 1);
    const fake = plain.started[0] as FakeSession;
    expect(await listNames(fake.input)).not.toContain('tasks_list');
    expect(fake.input.tools.handle('tasks_list', {}, new AbortController().signal)).rejects.toThrow(
      'tasks_list is not available to this agent.'
    );
    fake.finish();
    await unaddressedRun;
  });

  test('a session’s cost is reported as its running total under the session it ran in', async () => {
    const sessions = createSessions();
    const earlier = {
      inputTokens: 10,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0.1,
    };
    const { supervisor, dispatched, reject } = setup(
      withTask(createTempDir(), [createRun({ sessionId: 'sess-1' })]),
      { startSession: sessions.startSession }
    );
    const running = supervisor.execute('run-1');
    await until('the session', () => sessions.started.length === 1);
    sessions.started[0]?.finish('completed', {
      usage: { inputTokens: 30, outputTokens: 4, cacheReadTokens: 2, cacheWriteTokens: 0, costUsd: 0.25 },
    });
    await running;
    expect(dispatched.find((command) => command.type === 'run.meter')).toEqual({
      type: 'run.meter',
      runId: 'run-1',
      sessionId: 'sess-1',
      usage: { inputTokens: 30, outputTokens: 4, cacheReadTokens: 2, cacheWriteTokens: 0, costUsd: 0.25 },
    });
    reject((command) => command.type === 'run.meter', new Error('log full'));
    const again = supervisor.execute('run-1');
    await until('the second session', () => sessions.started.length === 2);
    sessions.started[1]?.finish('completed', { usage: earlier });
    await again;
    expect(endedRuns(dispatched)).toHaveLength(2);
  });

  test('hand-overs carry the tree they left, a plan its change summary, and a question its choices', async () => {
    const { path } = await createGitRepo({ remote: false });
    const sessions = createSessions();
    const { supervisor, dispatched } = setup(withTask(path), { startSession: sessions.startSession });
    const running = supervisor.execute('run-1');
    await until('the session', () => sessions.started.length === 1);
    const fake = sessions.started[0] as FakeSession;
    const call = (name: string, input: Record<string, unknown>) =>
      fake.input.tools.handle(name, input, new AbortController().signal);
    writeFiles(path, { 'a.txt': 'a' });
    await call('complete_fix', { summary: 'Fixed.', walkthrough: { flow: 'a → b' } });
    const tree = await git(path, 'rev-parse', 'HEAD^{tree}');
    expect(dispatched.find((command) => command.type === 'agent.complete_fix')).toMatchObject({
      summary: 'Fixed.',
      walkthrough: { flow: 'a → b' },
      treeHash: tree,
    });
    await call('propose_plan', {
      goal: 'Add the files.',
      phases: [
        { title: 'Write a', detail: 'Create a.txt.' },
        { title: 'Write b', detail: 'Create b.txt.' },
      ],
      behaviour: [],
      approach: 'Write them.',
      files: [],
      out_of_scope: [],
      verification: [],
      questions: [],
      change_summary: 'Split the work in two.',
    });
    expect(dispatched.find((command) => command.type === 'agent.propose_plan')).toMatchObject({
      changeSummary: 'Split the work in two.',
    });
    const withdraw = new AbortController();
    const asked = fake.input.tools.handle(
      'ask',
      { question: 'Which?', choices: ['Blue', 'Green'], recommendation: 'Blue' },
      withdraw.signal
    );
    await until('the question', () => dispatched.some((command) => command.type === 'agent.ask'));
    expect(dispatched.find((command) => command.type === 'agent.ask')).toMatchObject({
      question: 'Which?',
      context: null,
      choices: ['Blue', 'Green'],
      recommendation: 'Blue',
    });
    withdraw.abort();
    expect(await asked).toBe('The question was withdrawn. Continue with your best judgement.');
    fake.finish();
    await running;
  });
});

describe('accounts', () => {
  const limit = {
    class: 'usage_limit',
    message: 'Limit.',
    code: 'rate_limit',
    retryable: true,
    resetAt: 9,
  } as const;

  function leases(...picked: ({ id: string; email: string | null; configDir: string | null } | null)[]) {
    const requests: unknown[] = [];
    return {
      requests,
      broker: createBroker((request) => {
        requests.push(request);
        const next = picked.shift() ?? null;
        return Promise.resolve(next ? { ...next, reason: 'usage_limit' as const } : null);
      }),
    };
  }

  test('a run on an account sends the weekly readings from when it started and ended, the end read fresh', async () => {
    const sessions = createSessions();
    const { broker } = leases({ id: 'acc-work', email: 'work@example.com', configDir: '/accounts/work' });
    const { supervisor, dispatched } = setup(
      (state) => {
        state.repos['repo-1'] = createRepo();
        state.tasks['task-1'] = createTask({ worktreePath: createTempDir() });
        state.runs['run-1'] = createRun({ model: 'opus' });
      },
      {
        startSession: sessions.startSession,
        accounts: {
          ...broker,
          readWeeklyReading: (_, force) =>
            Promise.resolve({ percent: force ? 23 : 20, at: force ? 2_000 : 1_000, resetsAt: 9_000 }),
        },
      }
    );
    const running = supervisor.execute('run-1');
    await until('the session', () => sessions.started.length === 1);
    sessions.started[0]?.finish('completed', {
      usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: null },
    });
    await running;
    expect(dispatched.find((command) => command.type === 'run.meter')).toMatchObject({
      type: 'run.meter',
      runId: 'run-1',
      readings: [
        { percent: 20, at: 1_000, resetsAt: 9_000 },
        { percent: 23, at: 2_000, resetsAt: 9_000 },
      ],
    });
  });

  test('a weekly reading that fails leaves a finished run completed and sends no readings', async () => {
    const sessions = createSessions();
    const { broker } = leases({ id: 'acc-work', email: 'work@example.com', configDir: '/accounts/work' });
    const { supervisor, dispatched } = setup(
      (state) => {
        state.repos['repo-1'] = createRepo();
        state.tasks['task-1'] = createTask({ worktreePath: createTempDir() });
        state.runs['run-1'] = createRun({ model: 'opus' });
      },
      {
        startSession: sessions.startSession,
        accounts: { ...broker, readWeeklyReading: () => Promise.reject(new Error('usage is down')) },
      }
    );
    const running = supervisor.execute('run-1');
    await until('the session', () => sessions.started.length === 1);
    sessions.started[0]?.finish('completed', {
      usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: null },
    });
    await running;
    expect(dispatched.find((command) => command.type === 'run.meter')).not.toHaveProperty('readings');
    expect(dispatched.find((command) => command.type === 'run.end')).toMatchObject({ outcome: 'completed' });
  });

  test('fast mode runs only on an account with usage credits; otherwise standard speed, and the chat says why', async () => {
    const sessions = createSessions();
    const work = { id: 'acc-work', email: 'work@example.com', configDir: '/accounts/work' };
    const { broker } = leases(work, work, work);
    const asked: [string, string | null][] = [];
    const answers: FastModeAvailability[] = ['needs_credits', 'unknown', 'available'];
    const { supervisor, transcripts, update } = setup(
      (state) => {
        withTask(createTempDir())(state);
        state.settings.fastMode = true;
      },
      {
        startSession: sessions.startSession,
        accounts: {
          ...broker,
          readFastMode: (provider, accountId) => {
            asked.push([provider, accountId]);
            return Promise.resolve(answers.shift() ?? 'available');
          },
        },
      }
    );
    for (const [index, runId] of ['run-1', 'run-2', 'run-3'].entries()) {
      update((state) => {
        state.runs[runId] = createRun({ id: runId, startedAt: index + 1 });
      });
      const running = supervisor.execute(runId);
      await until('the session', () => sessions.started.length === index + 1);
      sessions.started[index]?.finish();
      await running;
      update((state) => {
        state.runs[runId] = { ...createRun({ id: runId }), endedAt: index + 2, outcome: 'completed' };
      });
    }
    expect(sessions.started.map((session) => session.input.fastMode)).toEqual([false, false, true]);
    expect(asked).toEqual([
      ['claude', 'acc-work'],
      ['claude', 'acc-work'],
      ['claude', 'acc-work'],
    ]);
    const reasons = ['run-1', 'run-2', 'run-3'].map((runId) =>
      transcripts
        .listEntries(runId)
        .flatMap((entry) =>
          entry.type === 'notice' && entry.notice.kind === 'fast_mode' ? [entry.notice.reason] : []
        )
    );
    expect(reasons).toEqual([['needs_credits'], ['credits_unknown'], []]);
  });

  test('a run whose provider started agents of its own is charged for each of their sessions', async () => {
    const sessions = createSessions();
    const { supervisor, dispatched } = setup(withTask(createTempDir()), {
      startSession: sessions.startSession,
    });
    const running = supervisor.execute('run-1');
    await until('the session', () => sessions.started.length === 1);
    const usage = {
      inputTokens: 10,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0.01,
    };
    sessions.started[0]?.input.onSession('main');
    sessions.started[0]?.finish('completed', {
      usage,
      subagentUsage: [{ sessionId: 'agent-1', usage: { ...usage, costUsd: null } }],
    });
    await running;
    const meters = dispatched.filter((command) => command.type === 'run.meter');
    expect(meters).toEqual([
      { type: 'run.meter', runId: 'run-1', sessionId: 'main', usage },
      { type: 'run.meter', runId: 'run-1', sessionId: 'agent-1', usage: { ...usage, costUsd: null } },
    ]);
  });

  test('each attempt runs on the account the broker picks, which the attempt records and the session gets', async () => {
    const sessions = createSessions();
    const work = { id: 'acc-work', email: 'work@example.com', configDir: '/accounts/work' };
    const { requests, broker } = leases(work);
    const { supervisor, dispatched } = setup(
      (state) => {
        state.repos['repo-1'] = createRepo();
        state.tasks['task-1'] = createTask({
          worktreePath: createTempDir(),
          account: { id: 'acc-work', email: null },
        });
        state.runs['run-1'] = createRun({ model: 'opus' });
      },
      { startSession: sessions.startSession, accounts: broker }
    );
    const running = supervisor.execute('run-1');
    await until('the session', () => sessions.started.length === 1);
    expect(sessions.started[0]?.input.account).toEqual({ id: 'acc-work', configDir: '/accounts/work' });
    sessions.started[0]?.finish();
    await running;
    expect(requests).toEqual([
      {
        runId: 'run-1',
        taskId: 'task-1',
        model: 'opus',
        bound: { id: 'acc-work', email: null },
        previous: null,
        exclude: [],
      },
    ]);
    expect(dispatched.find((command) => command.type === 'run.attempt')).toMatchObject({
      account: { id: 'acc-work', email: 'work@example.com' },
    });
  });

  test('a run bound to an account leases that account, over the account its task is bound to', async () => {
    const sessions = createSessions();
    const home = { id: 'acc-home', email: 'home@example.com', configDir: null };
    const { requests, broker } = leases(home);
    const { supervisor } = setup(
      (state) => {
        state.repos['repo-1'] = createRepo();
        state.tasks['task-1'] = createTask({
          worktreePath: createTempDir(),
          account: { id: 'acc-work', email: null },
        });
        state.runs['run-1'] = createRun({
          model: 'opus',
          account: { id: 'acc-home', email: 'home@example.com' },
        });
      },
      { startSession: sessions.startSession, accounts: broker }
    );
    const running = supervisor.execute('run-1');
    await until('the session', () => sessions.started.length === 1);
    sessions.started[0]?.finish();
    await running;
    expect(requests).toEqual([
      expect.objectContaining({ bound: { id: 'acc-home', email: 'home@example.com' } }),
    ]);
  });

  test('moving to another account than the last attempt of the task says so in the chat, and failures name the account', async () => {
    const sessions = createSessions();
    const rejections: RunRejection[] = [];
    const home = { id: 'acc-home', email: 'home@example.com', configDir: null };
    const work = { id: 'acc-work', email: 'work@example.com', configDir: '/accounts/work' };
    const { broker } = leases(work, home);
    const earlier = createRun({
      id: 'run-0',
      endedAt: 2,
      attempts: [
        { attemptId: 'x', provider: 'claude', model: null, resumed: false, handoff: null, startedAt: 1 },
        {
          attemptId: 'y',
          provider: 'claude',
          model: null,
          resumed: false,
          handoff: null,
          startedAt: 2,
          account: { id: 'acc-home', email: 'home@example.com' },
        },
      ],
    });
    const other = createRun({ id: 'run-9', taskId: 'task-9', endedAt: 3 });
    const { supervisor, dispatched, transcripts } = setup(
      withTask(createTempDir(), [earlier, other, createRun()]),
      {
        startSession: sessions.startSession,
        accounts: broker,
        onRejection: (rejection) => {
          rejections.push(rejection);
          return { retry: rejections.length === 1 };
        },
      }
    );
    const running = supervisor.execute('run-1');
    await until('the first session', () => sessions.started.length === 1);
    sessions.started[0]?.finish('failed', { failure: limit });
    await until('the retry', () => sessions.started.length === 2);
    expect(sessions.started[1]?.input.account).toEqual({ id: 'acc-home', configDir: null });
    sessions.started[1]?.finish('failed', { failure: limit });
    await running;
    expect(
      rejections.map((rejection) => [rejection.accountId, rejection.tried, rejection.failure.account])
    ).toEqual([
      ['acc-work', ['acc-work'], { id: 'acc-work', email: 'work@example.com' }],
      ['acc-home', ['acc-work', 'acc-home'], { id: 'acc-home', email: 'home@example.com' }],
    ]);
    const notices = transcripts
      .listEntries('run-1')
      .flatMap((entry) =>
        entry.type === 'notice' && entry.notice.kind === 'account_switched' ? [entry.notice] : []
      );
    expect(notices).toEqual([
      {
        kind: 'account_switched',
        email: 'work@example.com',
        previous: 'home@example.com',
        reason: 'usage_limit',
      },
    ]);
    expect(endedRuns(dispatched)[0]).toMatchObject({
      failure: { account: { id: 'acc-home', email: 'home@example.com' } },
    });
  });

  test('the handler can rewrite the failure the run ends with', async () => {
    const sessions = createSessions();
    let offered = 0;
    const { supervisor, dispatched } = setup(withTask(createTempDir()), {
      startSession: sessions.startSession,
      onRejection: () => {
        offered += 1;
        return offered < 3 ? { retry: true } : { retry: false, failure: { ...limit, resetAt: 42 } };
      },
    });
    const running = supervisor.execute('run-1');
    for (let index = 0; index < 3; index += 1) {
      await until(`attempt ${index + 1}`, () => sessions.started.length === index + 1);
      sessions.started[index]?.finish('failed', { failure: limit });
    }
    await running;
    expect(offered).toBe(3);
    expect(endedRuns(dispatched)[0]).toMatchObject({ failure: { resetAt: 42 } });
  });

  test('a login read again is tried once more on the same account before the turn moves on', async () => {
    const sessions = createSessions();
    const work = { id: 'acc-work', email: 'work@example.com', configDir: '/accounts/work' };
    const home = { id: 'acc-home', email: 'home@example.com', configDir: null };
    const { broker, requests } = leases(work, work, home);
    const rejections: RunRejection[] = [];
    const expired = { ...limit, class: 'auth', code: 'authentication_failed', resetAt: null } as const;
    const { supervisor } = setup(withTask(createTempDir()), {
      startSession: sessions.startSession,
      accounts: broker,
      onRejection: (rejection) => {
        rejections.push(rejection);
        if (rejection.renewed.length === 0) return { retry: true, renewed: rejection.accountId as string };
        return { retry: rejection.tried.length < 2 };
      },
    });
    const running = supervisor.execute('run-1');
    for (let index = 0; index < 3; index += 1) {
      await until(`attempt ${index + 1}`, () => sessions.started.length === index + 1);
      sessions.started[index]?.finish('failed', { failure: expired });
    }
    await running;
    expect(rejections.map((rejection) => [rejection.tried, rejection.renewed])).toEqual([
      [['acc-work'], []],
      [['acc-work'], ['acc-work']],
      [['acc-work', 'acc-home'], ['acc-work']],
    ]);
    expect(requests).toEqual([
      expect.objectContaining({ bound: null, exclude: [] }),
      expect.objectContaining({ bound: { id: 'acc-work', email: 'work@example.com' }, exclude: [] }),
      expect.objectContaining({ bound: null, exclude: ['acc-work'] }),
    ]);
  });

  test('the accounts handler alone decides how often a turn moves, and a restored session costs it no account', async () => {
    const sessions = createSessions();
    const pool = [
      { id: 'acc-a', email: null, configDir: null },
      { id: 'acc-a', email: null, configDir: null },
      { id: 'acc-b', email: null, configDir: null },
      { id: 'acc-c', email: null, configDir: null },
    ];
    const { broker, requests } = leases(...pool);
    const rejections: RunRejection[] = [];
    const { supervisor, dispatched } = setup(withTask(createTempDir(), [createRun({ sessionId: 'old' })]), {
      startSession: sessions.startSession,
      accounts: broker,
      onRejection: (rejection) => {
        rejections.push(rejection);
        if (rejection.tried.length < 3) return { retry: true };
        return { retry: false, failure: { ...rejection.failure, resetAt: 100 } };
      },
    });
    const running = supervisor.execute('run-1');
    await until('the first session', () => sessions.started.length === 1);
    sessions.started[0]?.finish('failed', {
      failure: { class: 'session_lost', message: 'gone', code: 'x', retryable: null, resetAt: null },
    });
    for (let index = 1; index < 4; index += 1) {
      await until(`attempt ${index + 1}`, () => sessions.started.length === index + 1);
      sessions.started[index]?.finish('failed', { failure: { ...limit, resetAt: index * 1000 } });
    }
    await running;
    expect(rejections.map((rejection) => rejection.tried)).toEqual([
      ['acc-a'],
      ['acc-a', 'acc-b'],
      ['acc-a', 'acc-b', 'acc-c'],
    ]);
    expect(requests.map((request) => (request as { exclude: string[] }).exclude)).toEqual([
      [],
      [],
      ['acc-a'],
      ['acc-a', 'acc-b'],
    ]);
    expect(endedRuns(dispatched)[0]).toMatchObject({ failure: { resetAt: 100 } });
  });

  test('without a broker, or with a provider that cannot switch accounts, attempts carry no account', async () => {
    const sessions = createSessions();
    const plain = setup(withTask(createTempDir()), { startSession: sessions.startSession });
    const running = plain.supervisor.execute('run-1');
    await until('the session', () => sessions.started.length === 1);
    expect(sessions.started[0]?.input.account).toBeUndefined();
    sessions.started[0]?.finish();
    await running;
    expect(plain.dispatched.find((command) => command.type === 'run.attempt')).not.toHaveProperty('account');

    const { broker, requests } = leases({ id: 'a', email: null, configDir: null });
    const legacy: AgentProvider = {
      id: 'claude',
      label: 'Claude',
      capabilities: { ...CLAUDE_CAPABILITIES, accounts: false },
      startSession: sessions.startSession,
      listModels: () => Promise.resolve([]),
      complete: () => Promise.resolve(null),
    };
    const other = setup(withTask(createTempDir()), {
      providers: new ProviderRegistry([legacy]),
      accounts: broker,
    });
    const second = other.supervisor.execute('run-1');
    await until('the second session', () => sessions.started.length === 2);
    sessions.started[1]?.finish();
    await second;
    expect(requests).toEqual([]);
  });

  test('a broker with no account to offer leaves the session on the default login', async () => {
    const sessions = createSessions();
    const { broker } = leases(null);
    const { supervisor } = setup(withTask(createTempDir()), {
      startSession: sessions.startSession,
      accounts: broker,
    });
    const running = supervisor.execute('run-1');
    await until('the session', () => sessions.started.length === 1);
    expect(sessions.started[0]?.input.account).toBeUndefined();
    sessions.started[0]?.finish();
    await running;
  });
});

describe('a usage limit on another run of the same account', () => {
  const limit = {
    class: 'usage_limit',
    message: 'Limit.',
    code: 'rate_limit',
    retryable: true,
    resetAt: 9,
  } as const;

  function startOnAccounts(options: SupervisorOptions = {}) {
    const sessions = createSessions();
    const spent = new Set<string>();
    const account = (id: string) => ({ id, email: `${id}@example.com`, configDir: null, reason: null });
    const context = setup(
      (state) => {
        state.repos['repo-1'] = createRepo();
        for (const index of [1, 2, 3]) {
          state.tasks[`task-${index}`] = createTask({ id: `task-${index}`, worktreePath: createTempDir() });
          state.runs[`run-${index}`] = createRun({ id: `run-${index}`, taskId: `task-${index}` });
        }
      },
      {
        startSession: sessions.startSession,
        accounts: createBroker((request) => {
          const free = request.runId === 'run-3' || spent.has('acc-a');
          return Promise.resolve(account(free ? 'acc-b' : 'acc-a'));
        }),
        onRejection: (rejection) => {
          if (rejection.accountId) spent.add(rejection.accountId);
          return { retry: rejection.runId === 'run-2' };
        },
        ...options,
      }
    );
    const runs: Promise<void>[] = [];
    const start = async (runId: string) => {
      runs.push(context.supervisor.execute(runId));
      await until(`the session of ${runId}`, () => sessions.started.length === runs.length);
      return sessions.started[runs.length - 1] as FakeSession;
    };
    return { ...context, sessions, runs, start };
  }

  test('a message for a run on the spent account goes to its next turn, while other accounts still take it', async () => {
    const context = startOnAccounts();
    const first = await context.start('run-1');
    const second = await context.start('run-2');
    const third = await context.start('run-3');
    first.finish('failed', { failure: limit });
    await context.runs[0];
    await context.supervisor.steer('run-2', 'Use tabs.');
    await context.supervisor.steer('run-3', 'Use spaces.');
    expect(second.steers).toEqual([]);
    expect(third.steers).toEqual(['Use spaces.']);
    expect(context.dispatched.filter((command) => command.type === 'message.deliver')).toEqual([
      { type: 'message.deliver', taskId: 'task-2', text: 'Use tabs.' },
    ]);
    second.finish('failed', { failure: limit });
    await until('the next attempt', () => context.sessions.started.length === 4);
    await context.supervisor.steer('run-2', 'Use tabs again.');
    expect(context.sessions.started[3]?.input.account?.id).toBe('acc-b');
    expect(context.sessions.started[3]?.steers).toEqual(['Use tabs again.']);
    for (const fake of [third, context.sessions.started[3]]) fake?.finish();
    await Promise.all(context.runs);
  });

  test('a run waiting on your answer on the spent account lets its session go, and the answer resumes it elsewhere', async () => {
    const context = startOnAccounts({ idle: { idleMs: 60_000 } });
    const first = await context.start('run-1');
    const second = await context.start('run-2');
    const question = second.input.tools.handle(
      'ask',
      { question: 'Blue or green?' },
      new AbortController().signal
    );
    await until('the question', () => context.dispatched.some((command) => command.type === 'agent.ask'));
    const asked = context.dispatched.find((command) => command.type === 'agent.ask');
    const gateId = asked && 'gateId' in asked ? asked.gateId : '';
    context.update((state) => {
      state.gates[gateId] = createGate({ id: gateId, taskId: 'task-2', runId: 'run-2' });
    });
    first.finish('failed', { failure: limit });
    await until('the release', () => second.cancelled);
    expect(await question).toBe('The question was withdrawn. Continue with your best judgement.');
    await Promise.all(context.runs);
    expect(endedRuns(context.dispatched)).toEqual([expect.objectContaining({ runId: 'run-1' })]);

    context.update((state) => {
      state.gates[gateId] = createGate({
        id: gateId,
        taskId: 'task-2',
        runId: 'run-2',
        status: 'answered',
        response: 'Blue',
      });
    });
    const resumed = context.supervisor.resolveQuestion(gateId);
    await until('the resumed session', () => context.sessions.started.length === 3);
    expect(context.sessions.started[2]?.input.prompt).toContain('Blue');
    expect(context.sessions.started[2]?.input.account?.id).toBe('acc-b');
    context.sessions.started[2]?.finish();
    await resumed;
  });
});

describe('secret requests, schedule tools and idle sessions', () => {
  const REF = `secret-ref:${'a'.repeat(32)}`;

  function running(options: SupervisorOptions = {}) {
    const sessions = createSessions();
    const context = setup(withTask(createTempDir()), { startSession: sessions.startSession, ...options });
    const run = context.supervisor.execute('run-1');
    return { ...context, sessions, run };
  }

  async function asked(context: ReturnType<typeof running>, type: 'ask' | 'request_secret') {
    const command = type === 'ask' ? 'agent.ask' : 'agent.request_secret';
    await until('the question', () => context.dispatched.some((entry) => entry.type === command));
    const found = context.dispatched.find((entry) => entry.type === command);
    return found && 'gateId' in found ? found.gateId : '';
  }

  test('request_secret waits for the human and hands back the ref, never a value', async () => {
    const context = running();
    await until('the session', () => context.sessions.started.length === 1);
    const { input, finish } = context.sessions.started[0] as FakeSession;
    const signal = new AbortController().signal;
    const reply = input.tools.handle(
      'request_secret',
      { label: 'GitHub webhook secret', reason: 'For the hook.' },
      signal
    );
    const gateId = await asked(context, 'request_secret');
    expect(context.dispatched.find((entry) => entry.type === 'agent.request_secret')).toMatchObject({
      runId: 'run-1',
      label: 'GitHub webhook secret',
      reason: 'For the hook.',
    });
    context.update((state) => {
      state.gates[gateId] = createGate({ id: gateId, status: 'answered', decision: 'reply', response: REF });
    });
    await context.supervisor.resolveQuestion(gateId);
    expect(await reply).toBe(
      `The human saved the GitHub webhook secret. Pass ${REF} where a secret is asked for, such as set_schedule’s webhook.signature.secret_ref. It works once and expires in a day; you never see the value.`
    );
    finish();
    await context.run;
  });

  test('a declined, withdrawn, broken or refused secret request says so', async () => {
    const context = running();
    await until('the session', () => context.sessions.started.length === 1);
    const { input, finish } = context.sessions.started[0] as FakeSession;
    const live = new AbortController();
    const declined = input.tools.handle('request_secret', { label: 'Token', reason: 'Why' }, live.signal);
    const gateId = await asked(context, 'request_secret');
    context.update((state) => {
      state.gates[gateId] = createGate({
        id: gateId,
        status: 'answered',
        decision: 'reject',
        response: null,
      });
    });
    await context.supervisor.resolveQuestion(gateId);
    expect(await declined).toBe('The human declined to give it. Continue without the secret.');

    const withdrawing = new AbortController();
    const withdrawn = input.tools.handle(
      'request_secret',
      { label: 'Token', reason: 'Why' },
      withdrawing.signal
    );
    await until(
      'the second request',
      () => context.dispatched.filter((entry) => entry.type === 'agent.request_secret').length === 2
    );
    withdrawing.abort();
    expect(await withdrawn).toBe(
      'The request was withdrawn. Continue without the secret, or ask again later.'
    );

    const superseding = input.tools.handle('request_secret', { label: 'Token', reason: 'Why' }, live.signal);
    await until(
      'the third request',
      () => context.dispatched.filter((entry) => entry.type === 'agent.request_secret').length === 3
    );
    const third = context.dispatched.filter((entry) => entry.type === 'agent.request_secret').at(-1);
    const thirdId = third && 'gateId' in third ? third.gateId : '';
    context.update((state) => {
      state.gates[thirdId] = createGate({ id: thirdId, status: 'withdrawn', supersededBy: 'Skip the hook.' });
    });
    await context.supervisor.resolveQuestion(thirdId);
    expect(await superseding).toBe(
      'The question was withdrawn. The human wrote this instead: Skip the hook.'
    );

    expect(input.tools.handle('request_secret', { label: 'Token' }, live.signal)).rejects.toThrow(
      'reason is required.'
    );
    const aborted = new AbortController();
    aborted.abort();
    expect(input.tools.handle('request_secret', { label: 'T', reason: 'R' }, aborted.signal)).rejects.toThrow(
      'This step was stopped.'
    );
    context.reject((command) => command.type === 'agent.request_secret', new Error('gate refused'));
    expect(input.tools.handle('request_secret', { label: 'T', reason: 'R' }, live.signal)).rejects.toThrow(
      'gate refused'
    );
    finish();
    await context.run;
  });

  test('schedule tools go to the schedules handler, and are unknown without one', async () => {
    const calls: string[] = [];
    const schedules = {
      handleTool: (name: string) => {
        calls.push(name);
        return name === 'list_schedules' ? Promise.resolve('[]') : null;
      },
    };
    const context = running({ schedules });
    await until('the session', () => context.sessions.started.length === 1);
    const { input, finish } = context.sessions.started[0] as FakeSession;
    const signal = new AbortController().signal;
    expect(await input.tools.handle('list_schedules', {}, signal)).toBe('[]');
    finish();
    await context.run;
    expect(calls).toEqual(['list_schedules']);

    const bare = running();
    await until('the session', () => bare.sessions.started.length === 1);
    const tools = (bare.sessions.started[0] as FakeSession).input.tools;
    expect(tools.handle('list_schedules', {}, signal)).rejects.toThrow('Unknown tool list_schedules.');
    bare.sessions.started[0]?.finish();
    await bare.run;
  });

  test('a session left waiting on an answer is released without ending the run, and the answer resumes it', async () => {
    const context = running({ idle: { idleMs: 5 } });
    await until('the session', () => context.sessions.started.length === 1);
    const first = context.sessions.started[0] as FakeSession;
    let activity = 0;
    first.input.onActivity?.();
    activity += 1;
    const question = first.input.tools.handle(
      'ask',
      { question: 'Blue or green?' },
      new AbortController().signal
    );
    const gateId = await asked(context, 'ask');
    context.update((state) => {
      state.gates[gateId] = createGate({ id: gateId, runId: 'run-1' });
    });
    await until('the release', () => first.cancelled);
    expect(await question).toBe('The question was withdrawn. Continue with your best judgement.');
    await context.run;
    expect(endedRuns(context.dispatched)).toEqual([]);
    expect(
      context.transcripts
        .listEntries('run-1')
        .filter((entry) => entry.type === 'status')
        .map((entry) => 'status' in entry && entry.status)
    ).toEqual(['started', 'waiting']);

    context.update((state) => {
      state.gates[gateId] = createGate({ id: gateId, runId: 'run-1', status: 'answered', response: 'Blue' });
    });
    const resumed = context.supervisor.resolveQuestion(gateId);
    await until('the resumed session', () => context.sessions.started.length === 2);
    expect(context.sessions.started[1]?.input.prompt).toContain('Blue');
    context.sessions.started[1]?.finish();
    await resumed;
    expect(endedRuns(context.dispatched)).toHaveLength(1);
    expect(activity).toBe(1);
  });

  test('a released session whose question a message supersedes resumes once, with the message', async () => {
    const context = running({ idle: { idleMs: 5 } });
    await until('the session', () => context.sessions.started.length === 1);
    const first = context.sessions.started[0] as FakeSession;
    void first.input.tools.handle('ask', { question: 'Blue or green?' }, new AbortController().signal);
    const gateId = await asked(context, 'ask');
    context.update((state) => {
      state.gates[gateId] = createGate({ id: gateId, runId: 'run-1' });
    });
    await until('the release', () => first.cancelled);
    await context.run;
    context.update((state) => {
      state.gates[gateId] = createGate({
        id: gateId,
        runId: 'run-1',
        status: 'withdrawn',
        supersededBy: 'Go green.',
      });
    });
    const resumed = context.supervisor.resolveQuestion(gateId);
    await until('the resumed session', () => context.sessions.started.length === 2);
    expect(context.sessions.started[1]?.input.prompt).toContain('Go green.');
    context.sessions.started[1]?.finish();
    await resumed;
    expect(context.sessions.started).toHaveLength(2);
    expect(context.dispatched.some((command) => command.type === 'message.deliver')).toBe(false);
  });

  test('a delegated agent waiting on the agent that delegated it is never released', async () => {
    const sessions = createSessions();
    const child = createRun({
      id: 'child',
      role: 'reviewer',
      delegation: {
        parentRunId: 'run-0',
        depth: 1,
        requestKey: 'k',
        title: 'Survey',
        brief: 'Survey.',
        mode: 'async',
        wake: 'always',
        isolation: 'shared',
        baseCommit: null,
        delivery: 'none',
        question: null,
        requestedAt: 1,
      },
    });
    const context = setup(withTask(createTempDir(), [createRun({ id: 'run-0' }), child]), {
      startSession: sessions.startSession,
      idle: { idleMs: 1 },
    });
    const run = context.supervisor.execute('child');
    await until('the session', () => sessions.started.length === 1);
    const question = sessions.started[0]?.input.tools.handle(
      'ask',
      { question: 'Which file?' },
      new AbortController().signal
    );
    await until('the question', () => context.dispatched.some((command) => command.type === 'agent.ask'));
    const found = context.dispatched.find((command) => command.type === 'agent.ask');
    const questionId = found && 'gateId' in found ? found.gateId : '';
    await Bun.sleep(20);
    expect(sessions.started[0]?.cancelled).toBe(false);
    context.update((state) => {
      const asking = state.runs.child;
      if (!asking?.delegation) return;
      asking.delegation.question = {
        id: questionId,
        question: 'Which file?',
        context: null,
        choices: [],
        recommendation: null,
        askedAt: 1,
        delivered: true,
        answer: 'a.ts',
        answeredAt: 2,
      };
    });
    await context.supervisor.replyToDelegate('child', questionId);
    expect(await question).toBe('The agent that delegated this work to you answered: a.ts');
    sessions.started[0]?.finish();
    await run;
    expect(endedRuns(context.dispatched)).toHaveLength(1);
  });

  test('an answer that arrives while the session is being released waits for it, then resumes', async () => {
    const stopped = Promise.withResolvers<void>();
    const done = Promise.withResolvers<AgentSessionResult>();
    const inputs: AgentSessionInput[] = [];
    let cancelling = false;
    const released = () => cancelling;
    const startSession = (input: AgentSessionInput): AgentSession => {
      inputs.push(input);
      if (inputs.length > 1)
        return {
          done: Promise.resolve({ outcome: 'completed', summary: null }),
          steer: () => true,
          cancel: () => Promise.resolve(),
        };
      return {
        done: done.promise,
        steer: () => true,
        cancel: async () => {
          cancelling = true;
          await stopped.promise;
          done.resolve({ outcome: 'cancelled', summary: null });
        },
      };
    };
    const context = setup(withTask(createTempDir()), { startSession, idle: { idleMs: 5 } });
    const run = context.supervisor.execute('run-1');
    await until('the session', () => inputs.length === 1);
    void inputs[0]?.tools.handle('ask', { question: 'Blue?' }, new AbortController().signal);
    const gateId = await (async () => {
      await until('the question', () => context.dispatched.some((entry) => entry.type === 'agent.ask'));
      const found = context.dispatched.find((entry) => entry.type === 'agent.ask');
      return found && 'gateId' in found ? found.gateId : '';
    })();
    context.update((state) => {
      state.gates[gateId] = createGate({ id: gateId, runId: 'run-1' });
    });
    await until(
      'the release to start',
      () => context.transcripts.listEntries('run-1').length > 0 && released()
    );
    context.update((state) => {
      state.gates[gateId] = createGate({ id: gateId, runId: 'run-1', status: 'answered', response: 'Blue' });
    });
    const answered = context.supervisor.resolveQuestion(gateId);
    await Bun.sleep(0);
    expect(inputs).toHaveLength(1);
    stopped.resolve();
    await run;
    await answered;
    expect(inputs).toHaveLength(2);
    expect(inputs[1]?.prompt).toContain('Blue');
  });

  test('a release that cannot stop the session is logged', async () => {
    const sessions = createSessions({ cancelFails: true });
    const context = setup(withTask(createTempDir()), {
      startSession: sessions.startSession,
      idle: { idleMs: 5 },
    });
    const run = context.supervisor.execute('run-1');
    await until('the session', () => sessions.started.length === 1);
    const warn = spyOn(log, 'warn').mockImplementation(() => undefined);
    void sessions.started[0]?.input.tools.handle('ask', { question: 'x' }, new AbortController().signal);
    await until('the release', () => sessions.started[0]?.cancelled === true);
    await run;
    await until('the warning', () =>
      warn.mock.calls.some(([message]) => message === '[Runs] Could not stop an idle session')
    );
    warn.mockRestore();
  });
});

describe('compacting an idle session', () => {
  const NOW = Date.parse('2026-10-23T12:00:00Z');

  const CONTEXT = {
    usedTokens: 170_000,
    maxTokens: 200_000,
    cacheExpiresAt: NOW + 60 * 60_000,
    backgroundWork: false,
  };

  const USAGE = {
    inputTokens: 10,
    outputTokens: 5,
    cacheReadTokens: 150_000,
    cacheWriteTokens: 0,
    costUsd: 0.05,
  };

  const refusals: Promise<string>[] = [];

  function compactingProvider(compacted: AgentSessionInput[], start: SessionStarter, compaction = true) {
    return fakeProvider('claude', start, {
      capabilities: { ...CLAUDE_CAPABILITIES, compaction },
      compactSession: (input) => {
        compacted.push({ ...input, prompt: '' });
        input.onSession('s1');
        refusals.push(
          Promise.resolve()
            .then(() => input.tools.handle('ask', {}, new AbortController().signal))
            .catch((error: Error) => error.message)
        );
        input.onEntry({ type: 'agent', phase: 'final', text: 'Here is the summary.' });
        input.onEntry({
          type: 'notice',
          notice: { kind: 'compaction', trigger: 'manual', preTokens: 150_000, summary: null },
        });
        return {
          done: Promise.resolve({ outcome: 'completed', summary: null, usage: USAGE }),
          steer: () => false,
          cancel: () => Promise.resolve(),
        };
      },
    });
  }

  async function finishBuilder(
    options: { compaction?: boolean; account?: boolean; compacted?: boolean; model?: string } = {}
  ) {
    const sessions = createSessions();
    const compacted: AgentSessionInput[] = [];
    const leases: unknown[] = [];
    const account = { id: 'acc-1', email: 'me@example.com' };
    const run = createRun({
      sessionId: 's1',
      attempts: [
        {
          attemptId: 'a1',
          provider: 'claude',
          model: options.model ?? null,
          resumed: false,
          handoff: null,
          startedAt: 1,
          ...(options.account ? { account } : {}),
        },
      ],
    });
    const context = setup(withIdleCompaction(withTask(createTempDir(), [run])), {
      providers: new ProviderRegistry([
        compactingProvider(compacted, sessions.startSession, options.compaction ?? true),
      ]),
      accounts: createBroker((request) => {
        leases.push(request);
        return Promise.resolve({ id: 'acc-1', email: null, configDir: '/accounts/one', reason: null });
      }),
      compaction: { now: () => NOW + 59 * 60_000 },
    });
    if (options.compacted !== false) {
      context.respond(
        (command) => command.type === 'run.compact',
        [{ type: 'run.compacted', runId: 'run-1', sessionId: 's1', seq: 1, at: 1 }]
      );
    }
    const running = context.supervisor.execute('run-1');
    await until('the session', () => sessions.started.length === 1);
    context.update((state) => {
      state.runs['run-1'] = { ...run, endedAt: 2, outcome: 'completed' };
    });
    sessions.started[0]?.finish('completed', { context: CONTEXT });
    await running;
    return { ...context, compacted, leases };
  }

  test('a finished builder is compacted once, on the account it ran on, and only the compaction notice is kept', async () => {
    const context = await finishBuilder({ account: true });
    await until('the compaction', () => context.dispatched.some((command) => command.type === 'run.meter'));
    expect(context.dispatched.filter((command) => command.type === 'run.compact')).toEqual([
      { type: 'run.compact', runId: 'run-1', sessionId: 's1' },
    ]);
    expect(
      context.commandIds[context.dispatched.findIndex((command) => command.type === 'run.compact')]
    ).toBe('idle-compact:run-1:s1');
    expect(context.commandIds).toContain('idle-compact:run-1:s1:run.meter');
    expect(context.compacted[0]).toMatchObject({
      resume: 's1',
      account: { id: 'acc-1', configDir: '/accounts/one' },
      compaction: 'claude',
      fastMode: true,
    });
    expect(context.leases).toHaveLength(2);
    expect(context.leases[1]).toEqual({
      runId: 'run-1',
      taskId: 'task-1',
      model: null,
      bound: { id: 'acc-1', email: 'me@example.com' },
      previous: { id: 'acc-1', email: 'me@example.com' },
      exclude: [],
    });
    const entries = context.transcripts.listEntries('run-1');
    expect(entries.some((entry) => entry.type === 'notice' && entry.notice.kind === 'compaction')).toBe(true);
    expect(entries.some((entry) => entry.type === 'agent' && entry.text === 'Here is the summary.')).toBe(
      false
    );
    expect(await refusals.at(-1)).toBe('This turn only compacts. End it.');
  });

  test('a session is compacted on the model its last attempt ran on', async () => {
    const context = await finishBuilder({ model: 'claude-sonnet-5' });
    await until('the compaction', () => context.compacted.length === 1);
    expect(context.compacted[0]?.model).toBe('claude-sonnet-5');
  });

  test('shutdown stops a compaction that is already running, and a stop that fails is logged', async () => {
    const sessions = createSessions();
    let cancelled = false;
    const done = Promise.withResolvers<AgentSessionResult>();
    const run = createRun({ sessionId: 's1' });
    const context = setup(withIdleCompaction(withTask(createTempDir(), [run])), {
      providers: new ProviderRegistry([
        fakeProvider('claude', sessions.startSession, {
          compactSession: () => ({
            done: done.promise,
            steer: () => false,
            cancel: () => {
              cancelled = true;
              done.resolve({ outcome: 'cancelled', summary: null });
              return Promise.reject(new Error('already gone'));
            },
          }),
        }),
      ]),
      compaction: { now: () => NOW + 59 * 60_000 },
    });
    context.respond(
      (command) => command.type === 'run.compact',
      [{ type: 'run.compacted', runId: 'run-1', sessionId: 's1', seq: 1, at: 1 }]
    );
    const running = context.supervisor.execute('run-1');
    await until('the session', () => sessions.started.length === 1);
    context.update((state) => {
      state.runs['run-1'] = { ...run, endedAt: 2, outcome: 'completed' };
    });
    sessions.started[0]?.finish('completed', { context: CONTEXT });
    await running;
    await until('the compaction', () => context.dispatched.some((command) => command.type === 'run.compact'));
    const warn = spyOn(log, 'warn').mockImplementation(() => undefined);
    await context.supervisor.interruptForShutdown();
    expect(cancelled).toBe(true);
    expect(warn).toHaveBeenCalledWith('[Runs] Could not stop a compaction', {
      runId: 'run-1',
      error: 'already gone',
    });
    warn.mockRestore();
  });

  test('a run without an account is compacted on the default login', async () => {
    const context = await finishBuilder();
    await until('the compaction', () => context.compacted.length === 1);
    expect(context.compacted[0]?.account).toBeUndefined();
    expect(context.leases).toHaveLength(1);
  });

  test('a compaction the log already holds, or a provider that cannot compact, starts nothing', async () => {
    const recorded = await finishBuilder({ compacted: false });
    await until('the record attempt', () =>
      recorded.dispatched.some((command) => command.type === 'run.compact')
    );
    await Bun.sleep(10);
    expect(recorded.compacted).toEqual([]);
    const unable = await finishBuilder({ compaction: false });
    await Bun.sleep(10);
    expect(unable.dispatched.some((command) => command.type === 'run.compact')).toBe(false);
    expect(unable.compacted).toEqual([]);
  });
});

describe('the ids of the commands a run sends', () => {
  const limit = {
    class: 'usage_limit',
    message: 'Limit.',
    code: 'rate_limit',
    retryable: true,
    resetAt: 9,
  } as const;

  const usage = { inputTokens: 3, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.01 };

  function listIds(context: Pick<StubEngine, 'dispatched' | 'commandIds'>) {
    return context.dispatched.map((command, index) => [command.type, context.commandIds[index]]);
  }

  test('each attempt is numbered within its run, and what it reports is named after it', async () => {
    const sessions = createSessions({ refuseSteer: true });
    let rejected = 0;
    const context = setup(withTask(createTempDir(), [createRun({ attempts: [] })]), {
      startSession: sessions.startSession,
      onRejection: () => {
        rejected += 1;
        return { retry: rejected === 1 };
      },
    });
    const running = context.supervisor.execute('run-1');
    await context.supervisor.steer('run-1', 'Use tabs.');
    await until('the first session', () => sessions.started.length === 1);
    sessions.started[0]?.input.onSession('s1');
    sessions.started[0]?.finish('failed', { failure: limit, usage });
    await until('the second session', () => sessions.started.length === 2);
    sessions.started[1]?.input.onSession('s2');
    sessions.started[1]?.finish('completed', { usage });
    await running;
    expect(listIds(context)).toEqual([
      ['run.attempt', 'run.attempt:run-1:1'],
      ['run.link', 'run.link:run-1:1:s1'],
      ['run.meter', 'run.meter:run-1:1'],
      ['run.attempt', 'run.attempt:run-1:2'],
      ['run.link', 'run.link:run-1:2:s2'],
      ['run.meter', 'run.meter:run-1:2'],
      ['run.end', 'run.end:run-1:2'],
      ['message.deliver', 'message.deliver:run-1:2:0'],
    ]);
  });

  test('the attempt number continues from the attempts the log already holds', async () => {
    const sessions = createSessions();
    const earlier = {
      attemptId: 'x',
      provider: 'claude',
      model: null,
      resumed: false,
      handoff: null,
      startedAt: 1,
    };
    const context = setup(withTask(createTempDir(), [createRun({ attempts: [earlier, earlier] })]), {
      startSession: sessions.startSession,
    });
    const running = context.supervisor.execute('run-1');
    await until('the session', () => sessions.started.length === 1);
    sessions.started[0]?.finish();
    await running;
    expect(context.dispatched[0]).toMatchObject({ type: 'run.attempt', attemptId: 'run-1:3' });
    expect(context.commandIds[0]).toBe('run.attempt:run-1:3');
  });

  test('a run that ends before any attempt ends under its own id, and a late message under the effect that carried it', async () => {
    const plain = setup((state) => {
      state.runs['run-1'] = createRun();
    });
    await plain.supervisor.execute('run-1');
    await plain.supervisor.steer('run-1', 'Later.', 'effect-7');
    await plain.supervisor.steer('run-1', 'Even later.');
    expect(listIds(plain)).toEqual([
      ['run.end', 'run.end:run-1'],
      ['message.deliver', 'effect-7:message.deliver'],
      ['message.deliver', null],
    ]);
  });

  test('a shutdown names each mark after the attempt it stops, or after the boot when none started yet', async () => {
    const sessions = createSessions();
    const context = setup(
      withTask(createTempDir(), [createRun(), createRun({ id: 'run-2', continuations: [5] })]),
      { startSession: sessions.startSession, quiesceMs: 60_000 }
    );
    const first = context.supervisor.execute('run-1');
    await until('the session', () => sessions.started.length === 1);
    const second = context.supervisor.execute('run-2');
    await context.supervisor.interruptForShutdown();
    await Promise.all([first, second]);
    expect(listIds(context).filter(([type]) => type === 'run.interrupt')).toEqual([
      ['run.interrupt', 'run.interrupt:run-1:1'],
      ['run.interrupt', 'run.interrupt:run-2:0:1'],
    ]);
  });

  test('a boot names what it sends after the log position it started from', async () => {
    const context = setup((state) => {
      withTask(createTempDir(), [createRun({ status: 'waiting' })])(state);
      state.seq = 41;
    });
    await context.supervisor.recover();
    expect(listIds(context)).toEqual([
      ['run.continue', 'boot:41:run.continue:run-1'],
      ['runs.dispatch', 'boot:41:runs.dispatch'],
      ['delegations.recover', 'boot:41:delegations.recover'],
    ]);
  });

  test('a tool call names its commands after the MCP request, and a call without one gets fresh ids', async () => {
    const sessions = createSessions();
    const context = setup(withTask(createTempDir()), { startSession: sessions.startSession });
    const running = context.supervisor.execute('run-1');
    await until('the session', () => sessions.started.length === 1);
    const tools = (sessions.started[0] as FakeSession).input.tools;
    const signal = new AbortController().signal;
    await tools.handle('note', { note: 'Working.' }, signal, 7);
    await tools.handle('suggest_tasks', { tasks: [{ title: 'T', request: 'R', why: 'W' }] }, signal, 'eight');
    await tools.handle('note', { note: 'Still working.' }, signal);
    const question = new AbortController();
    const asking = tools.handle('ask', { question: 'Blue or green?' }, question.signal, 9);
    await until('the question', () => context.dispatched.some((command) => command.type === 'agent.ask'));
    question.abort();
    await asking;
    sessions.started[0]?.finish();
    await running;
    expect(listIds(context).filter(([type]) => type?.startsWith('agent.'))).toEqual([
      ['agent.note', 'agent:run-1:run-1:1:call:7:agent.note'],
      ['agent.suggest_tasks', 'agent:run-1:run-1:1:call:eight:agent.suggest_tasks'],
      ['agent.note', null],
      ['agent.ask', 'agent:run-1:run-1:1:call:9:agent.ask'],
    ]);
  });

  test('an answer to a step that cannot resume reaches the task under the question’s id', async () => {
    const context = setup((state) => {
      withTask(createTempDir(), [createRun({ endedAt: 5 })])(state);
      state.gates.g1 = createGate({ id: 'g1', status: 'answered', response: 'Blue' });
    });
    await context.supervisor.resolveQuestion('g1');
    expect(listIds(context)).toEqual([['message.deliver', 'question:g1:message.deliver']]);
  });
});

describe('a command a run sends twice for one cause', () => {
  function createLoggedEngine(patch: (state: ShinsaState) => void) {
    const engine = new Engine(new EventLog(join(createTempDir(), 'db.sqlite')));
    patch(engine.state);
    for (const task of Object.values(engine.state.tasks)) task.activity = [];
    const sent: { command: ShinsaCommand; id: string | undefined }[] = [];
    const dispatch = engine.dispatch.bind(engine);
    spyOn(engine, 'dispatch').mockImplementation((command, options = {}) => {
      sent.push({ command, id: options.id });
      return dispatch(command, options);
    });
    const config = createTestConfig();
    const transcripts = new Transcripts(config.transcriptsDir);
    const sessions = createSessions();
    const supervisor = new RunSupervisor(engine, config, transcripts, new EvidenceStore(config.evidenceDir), {
      startSession: sessions.startSession,
    });
    const resend = async (type: ShinsaCommand['type']) => {
      const first = sent.find((entry) => entry.command.type === type);
      if (!first) throw new Error(`nothing sent as ${type}`);
      const seq = engine.state.seq;
      const events = await dispatch(first.command, { id: first.id });
      return { events, moved: engine.state.seq - seq };
    };
    return { engine, sent, supervisor, sessions, resend };
  }

  test('the end of an attempt is applied once, and its repeat answers with the same events', async () => {
    const { engine, supervisor, sessions, resend } = createLoggedEngine(withTask(createTempDir()));
    const running = supervisor.execute('run-1');
    await until('the session', () => sessions.started.length === 1);
    await supervisor.cancel('run-1');
    await running;
    expect(engine.state.runs['run-1']?.endedAt).not.toBeNull();
    const repeat = await resend('run.end');
    expect(repeat.moved).toBe(0);
    expect(repeat.events.map((event) => event.type)).toContain('run.ended');
  });

  test('a shutdown mark sent again after a crash is answered from its receipt', async () => {
    const { engine, supervisor, sessions, resend } = createLoggedEngine(withTask(createTempDir()));
    const running = supervisor.execute('run-1');
    await until('the session', () => sessions.started.length === 1);
    await supervisor.interruptForShutdown();
    await running;
    expect(engine.state.runs['run-1']?.resumePending).toBe(true);
    const repeat = await resend('run.interrupt');
    expect(repeat).toEqual({ events: [expect.objectContaining({ type: 'run.interrupted' })], moved: 0 });
  });
});
