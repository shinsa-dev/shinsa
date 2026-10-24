import { describe, expect, spyOn, test } from 'bun:test';
import type { DeliveryCohort, Run, RunDelegation, ShinsaCommand, ShinsaState } from '@shinsa/core';
import { RunSupervisor, type SupervisorOptions, Transcripts } from '../../src/agents/index.ts';
import { CLAUDE_CAPABILITIES } from '../../src/agents/providers/claude/index.ts';
import {
  type AgentSession,
  type AgentSessionInput,
  type AgentSessionResult,
  ProviderRegistry,
} from '../../src/agents/providers/index.ts';
import { log } from '../../src/log/index.ts';
import { EvidenceStore } from '../../src/store/index.ts';
import { createTempDir, createTestConfig, until } from '../helpers/index.ts';
import { createGate, createRepo, createRun, createStubEngine, createTask } from '../helpers/state.ts';

type Broker = NonNullable<SupervisorOptions['accounts']>;

function createBroker(lease: Broker['lease']): Broker {
  return {
    lease,
    readWeeklyPercent: () => Promise.resolve(null),
    readProviderWeeklyPercent: () => Promise.resolve(null),
    readFastMode: () => Promise.resolve('available'),
  };
}

interface FakeSession {
  input: AgentSessionInput;
  finish: (extra?: Partial<AgentSessionResult>) => void;
  steers: string[];
}

function createSessions(options: { refuseSteer?: boolean } = {}) {
  const started: FakeSession[] = [];
  const startSession = (input: AgentSessionInput): AgentSession => {
    const done = Promise.withResolvers<AgentSessionResult>();
    const fake: FakeSession = {
      input,
      steers: [],
      finish: (extra = {}) => done.resolve({ outcome: 'completed', summary: 'done', ...extra }),
    };
    started.push(fake);
    return {
      done: done.promise,
      steer: (text) => {
        if (options.refuseSteer) return false;
        fake.steers.push(text);
        return true;
      },
      cancel: () => {
        done.resolve({ outcome: 'cancelled', summary: null });
        return Promise.resolve();
      },
    };
  };
  return { started, startSession };
}

function delegation(patch: Partial<RunDelegation> = {}): RunDelegation {
  return {
    parentRunId: 'run-1',
    depth: 1,
    requestKey: 'k',
    title: 'Survey the greetings',
    brief: 'Survey them.',
    mode: 'async',
    wake: 'always',
    isolation: 'shared',
    baseCommit: null,
    delivery: 'none',
    question: null,
    requestedAt: 1,
    ...patch,
  };
}

function cohort(via: 'steer' | 'wake'): DeliveryCohort {
  return {
    nextGeneration: 2,
    claim: { generation: 1, items: ['result:child'], via },
    deferred: false,
    messages: [],
  };
}

function finishedChild(patch: Partial<Run> = {}) {
  return createRun({
    id: 'child',
    role: 'reviewer',
    endedAt: 5,
    outcome: 'completed',
    summary: 'Found two greetings.',
    delegation: delegation(),
    ...patch,
  });
}

function setup(runs: Run[], options: SupervisorOptions = {}) {
  const worktree = createTempDir();
  const stub = createStubEngine((state: ShinsaState) => {
    state.repos['repo-1'] = createRepo();
    state.tasks['task-1'] = createTask({ worktreePath: worktree });
    for (const run of runs) state.runs[run.id] = run;
  });
  const config = createTestConfig();
  const transcripts = new Transcripts(config.transcriptsDir);
  const supervisor = new RunSupervisor(
    stub.engine,
    config,
    transcripts,
    new EvidenceStore(config.evidenceDir),
    options
  );
  return { ...stub, config, transcripts, supervisor, worktree };
}

function ofType(dispatched: ShinsaCommand[], type: ShinsaCommand['type']): unknown[] {
  return dispatched.filter((command) => command.type === type);
}

function idsOf(
  context: { dispatched: ShinsaCommand[]; commandIds: (string | null)[] },
  type: ShinsaCommand['type']
) {
  return context.commandIds.filter((_, index) => context.dispatched[index]?.type === type);
}

describe('starting a delegated run', () => {
  test('a read-only step, delegated or not, fails on a provider that cannot keep it from changing files', async () => {
    const sessions = createSessions();
    const reviewer = createRun({ id: 'run-2', role: 'reviewer' });
    const { supervisor, dispatched } = setup(
      [createRun(), reviewer, finishedChild({ endedAt: null, outcome: null })],
      {
        providers: new ProviderRegistry([
          {
            id: 'claude',
            label: 'Claude',
            capabilities: { ...CLAUDE_CAPABILITIES, planning: { readOnly: false } },
            startSession: sessions.startSession,
            listModels: () => Promise.resolve([]),
            complete: () => Promise.resolve(null),
          },
        ]),
      }
    );
    await supervisor.execute('child');
    await supervisor.execute('run-2');
    expect(sessions.started).toHaveLength(0);
    expect(ofType(dispatched, 'run.end')).toEqual([
      expect.objectContaining({
        runId: 'child',
        outcome: 'failed',
        failure: expect.objectContaining({ class: 'setup_failed', code: 'read_only' }),
      }),
      expect.objectContaining({
        runId: 'run-2',
        outcome: 'failed',
        summary:
          'This agent provider cannot keep a read-only agent from changing files, so Shinsa will not run a read-only task on it.',
        failure: expect.objectContaining({ class: 'setup_failed', code: 'read_only' }),
      }),
    ]);
  });

  test('a delegated task whose own checkout cannot be made fails and says why', async () => {
    const sessions = createSessions();
    const child = finishedChild({
      role: 'builder',
      endedAt: null,
      outcome: null,
      delegation: delegation({ isolation: 'worktree', baseCommit: 'not-a-commit' }),
    });
    const { supervisor, dispatched } = setup([createRun(), child], { startSession: sessions.startSession });
    await supervisor.execute('child');
    expect(sessions.started).toHaveLength(0);
    expect(ofType(dispatched, 'run.end')).toEqual([
      expect.objectContaining({
        outcome: 'failed',
        summary:
          'Shinsa could not set up its own checkout: "not-a-commit" is not a commit Shinsa will pass to git.',
        failure: expect.objectContaining({ code: 'isolation' }),
      }),
    ]);
  });
});

describe('the account a delegated run uses', () => {
  test('a delegated agent of a task bound to an account runs on that account, like its parent', async () => {
    const sessions = createSessions();
    const requests: unknown[] = [];
    const work = {
      id: 'acc-work',
      email: 'work@example.com',
      configDir: '/accounts/work',
      reason: 'bound' as const,
    };
    const worktree = createTempDir();
    const stub = createStubEngine((state: ShinsaState) => {
      state.repos['repo-1'] = createRepo();
      state.tasks['task-1'] = createTask({
        worktreePath: worktree,
        account: { id: 'acc-work', email: null },
      });
      state.runs['run-1'] = createRun();
      state.runs.child = finishedChild({ endedAt: null, outcome: null, model: 'sonnet' });
    });
    const config = createTestConfig();
    const supervisor = new RunSupervisor(
      stub.engine,
      config,
      new Transcripts(config.transcriptsDir),
      new EvidenceStore(config.evidenceDir),
      {
        startSession: sessions.startSession,
        accounts: createBroker((request) => {
          requests.push(request);
          return Promise.resolve(work);
        }),
      }
    );
    const running = supervisor.execute('child');
    await until('the session', () => sessions.started.length === 1);
    expect(sessions.started[0]?.input.account).toEqual({ id: 'acc-work', configDir: '/accounts/work' });
    sessions.started[0]?.finish();
    await running;
    expect(requests).toEqual([
      expect.objectContaining({ runId: 'child', taskId: 'task-1', bound: { id: 'acc-work', email: null } }),
    ]);
  });
});

describe('the delegation tools in a session', () => {
  test('name only providers Shinsa has', async () => {
    const sessions = createSessions();
    const { supervisor } = setup([createRun()], { startSession: sessions.startSession });
    const running = supervisor.execute('run-1');
    await until('the session', () => sessions.started.length === 1);
    const handle = (provider: string) =>
      sessions.started[0]?.input.tools.handle(
        'delegate_task',
        { task: 'Check it.', role: 'reviewer', provider },
        new AbortController().signal
      );
    await expect(handle('nope')).rejects.toThrow(
      'Shinsa has no agent provider "nope". Leave provider unset to use the default.'
    );
    await expect(handle('claude')).rejects.toThrow('The task was not delegated. Try again.');
    sessions.started[0]?.finish();
    await running;
  });
  test('a delegate_task call the client repeats without a client_request_id finds the task it already made', async () => {
    const sessions = createSessions();
    const { supervisor, engine, update } = setup([createRun()], { startSession: sessions.startSession });
    const receipts = new Set<string>();
    const made: string[] = [];
    const dispatch = engine.dispatch.bind(engine);
    engine.dispatch = (command, options) => {
      const fresh = options?.id === undefined || !receipts.has(options.id);
      if (options?.id !== undefined) receipts.add(options.id);
      if (command.type === 'agent.delegate' && fresh) {
        made.push(`child-${made.length + 1}`);
        update((state) => {
          state.runs[`child-${made.length}`] = createRun({
            id: `child-${made.length}`,
            role: 'reviewer',
            delegation: delegation({ requestKey: command.requestKey }),
          });
        });
      }
      return dispatch(command, options);
    };
    const running = supervisor.execute('run-1');
    await until('the session', () => sessions.started.length === 1);
    const delegate = () =>
      sessions.started[0]?.input.tools.handle(
        'delegate_task',
        { task: 'Check it.', role: 'reviewer' },
        new AbortController().signal,
        7
      );
    const first = await delegate();
    expect(await delegate()).toBe(first);
    expect(made).toEqual(['child-1']);
    sessions.started[0]?.finish();
    await running;
  });
});

describe('delivering results into a running turn', () => {
  test('a report claimed before the session starts is held, then steered in once it does', async () => {
    const sessions = createSessions();
    const context = setup([createRun({ cohort: cohort('steer') }), finishedChild()], {
      startSession: sessions.startSession,
    });
    const { supervisor, dispatched, transcripts } = context;
    const running = supervisor.execute('run-1');
    await supervisor.deliver('run-1', 1);
    await until('the steer', () => sessions.started[0]?.steers.length === 1);
    expect(sessions.started[0]?.steers[0]).toContain('Found two greetings.');
    expect(ofType(dispatched, 'delegation.delivered')).toEqual([
      { type: 'delegation.delivered', runId: 'run-1', generation: 1, items: ['result:child'] },
    ]);
    expect(idsOf(context, 'delegation.delivered')).toEqual(['delegation.delivered:run-1:1']);
    expect(transcripts.listEntries('run-1').at(-1)).toMatchObject({
      type: 'notice',
      notice: { kind: 'delegation', event: 'reported', runIds: ['child'] },
    });
    sessions.started[0]?.finish();
    await running;
  });

  test('a report for a run whose account another run found spent waits for its next turn', async () => {
    const sessions = createSessions();
    const limit = {
      class: 'usage_limit',
      message: 'Limit.',
      code: 'rate_limit',
      retryable: true,
      resetAt: 9,
    } as const;
    const { supervisor, dispatched, update } = setup(
      [createRun({ cohort: cohort('steer') }), finishedChild()],
      {
        startSession: sessions.startSession,
        accounts: createBroker(() =>
          Promise.resolve({ id: 'acc-a', email: null, configDir: null, reason: null })
        ),
        onRejection: () => ({ retry: false }),
      }
    );
    update((state) => {
      state.tasks['task-2'] = createTask({ id: 'task-2', worktreePath: createTempDir() });
      state.runs['run-2'] = createRun({ id: 'run-2', taskId: 'task-2' });
    });
    const parent = supervisor.execute('run-1');
    await until('the parent session', () => sessions.started.length === 1);
    const other = supervisor.execute('run-2');
    await until('the other session', () => sessions.started.length === 2);
    sessions.started[1]?.finish({ outcome: 'failed', failure: limit });
    await other;
    await supervisor.deliver('run-1', 1);
    expect(sessions.started[0]?.steers).toEqual([]);
    expect(ofType(dispatched, 'delegation.undelivered')).toEqual([
      { type: 'delegation.undelivered', runId: 'run-1', generation: 1, items: [] },
    ]);
    sessions.started[0]?.finish();
    await parent;
  });

  test('a report the session never answered goes back to be delivered again', async () => {
    const sessions = createSessions();
    const context = setup([createRun({ cohort: cohort('steer') }), finishedChild()], {
      startSession: sessions.startSession,
    });
    const { supervisor, dispatched } = context;
    const running = supervisor.execute('run-1');
    await until('the session', () => sessions.started.length === 1);
    await supervisor.deliver('run-1', 1);
    const [text] = sessions.started[0]?.steers ?? [];
    sessions.started[0]?.finish({ undelivered: [text ?? '', 'Your own message'] });
    await running;
    expect(ofType(dispatched, 'delegation.undelivered')).toEqual([
      { type: 'delegation.undelivered', runId: 'run-1', generation: null, items: ['result:child'] },
    ]);
    expect(idsOf(context, 'delegation.undelivered')).toEqual(['delegation.undelivered:run-1:1:steered']);
  });

  test('a report steered into a session that is released while it asks goes back to be delivered', async () => {
    const started: { input: AgentSessionInput; steers: string[] }[] = [];
    const startSession = (input: AgentSessionInput): AgentSession => {
      const done = Promise.withResolvers<AgentSessionResult>();
      const fake = { input, steers: [] as string[] };
      started.push(fake);
      return {
        done: done.promise,
        steer: (text) => {
          fake.steers.push(text);
          return true;
        },
        cancel: () => {
          done.resolve({ outcome: 'cancelled', summary: null, undelivered: [...fake.steers] });
          return Promise.resolve();
        },
      };
    };
    const context = setup([createRun({ cohort: cohort('steer') }), finishedChild()], {
      startSession,
      idle: { idleMs: 5 },
    });
    const { supervisor, dispatched, update } = context;
    const running = supervisor.execute('run-1');
    await until('the session', () => started.length === 1);
    await supervisor.deliver('run-1', 1);
    expect(started[0]?.steers).toHaveLength(1);
    const question = started[0]?.input.tools.handle(
      'ask',
      { question: 'Blue or green?' },
      new AbortController().signal
    );
    await until('the question', () => dispatched.some((command) => command.type === 'agent.ask'));
    const asked = dispatched.find((command) => command.type === 'agent.ask');
    const gateId = asked && 'gateId' in asked ? asked.gateId : '';
    update((state) => {
      state.gates[gateId] = createGate({ id: gateId, runId: 'run-1' });
    });
    expect(await question).toBe('The question was withdrawn. Continue with your best judgement.');
    await running;
    expect(ofType(dispatched, 'run.end')).toEqual([]);
    expect(ofType(dispatched, 'delegation.undelivered')).toEqual([
      { type: 'delegation.undelivered', runId: 'run-1', generation: null, items: ['result:child'] },
    ]);
  });

  test('a report held for a session that never starts goes back to be delivered', async () => {
    const { supervisor, dispatched } = setup([createRun({ cohort: cohort('steer') }), finishedChild()], {
      startSession: () => {
        throw new Error('claude is not installed');
      },
    });
    const running = supervisor.execute('run-1');
    await supervisor.deliver('run-1', 1);
    await running;
    expect(ofType(dispatched, 'delegation.undelivered')).toEqual([
      { type: 'delegation.undelivered', runId: 'run-1', generation: 1, items: [] },
    ]);
  });

  test('a report a retried attempt never answered is steered into the next attempt, or handed back', async () => {
    const steers: string[][] = [];
    const finishes: ((result: AgentSessionResult) => void)[] = [];
    const startSession = (): AgentSession => {
      const done = Promise.withResolvers<AgentSessionResult>();
      const taken: string[] = [];
      const attempt = steers.length;
      steers.push(taken);
      finishes.push(done.resolve);
      return {
        done: done.promise,
        steer: (text) => {
          if (attempt === 2) return false;
          taken.push(text);
          return true;
        },
        cancel: () => Promise.resolve(),
      };
    };
    const limit = {
      class: 'usage_limit',
      message: 'Limit.',
      code: 'rate_limit',
      retryable: true,
      resetAt: 9,
    } as const;
    let offered = 0;
    const { supervisor, dispatched } = setup([createRun({ cohort: cohort('steer') }), finishedChild()], {
      startSession,
      onRejection: () => {
        offered += 1;
        return { retry: offered < 3 };
      },
    });
    const running = supervisor.execute('run-1');
    await until('the first attempt', () => steers.length === 1);
    await supervisor.deliver('run-1', 1);
    const report = steers[0]?.[0] ?? '';
    finishes[0]?.({ outcome: 'failed', summary: null, failure: limit, undelivered: [report] });
    await until('the second attempt', () => steers.length === 2);
    expect(steers[1]).toEqual([report]);
    finishes[1]?.({ outcome: 'failed', summary: null, failure: limit, undelivered: [report] });
    await until('the third attempt', () => steers.length === 3);
    finishes[2]?.({ outcome: 'failed', summary: null, failure: limit });
    await running;
    expect(ofType(dispatched, 'delegation.undelivered')).toEqual([
      { type: 'delegation.undelivered', runId: 'run-1', generation: null, items: ['result:child'] },
    ]);
    expect(ofType(dispatched, 'message.deliver')).toEqual([]);
  });

  test('a report for a run with no turn, or a session that refuses it, is handed back for waking', async () => {
    const idle = setup([createRun({ cohort: cohort('steer') }), finishedChild()]);
    await idle.supervisor.deliver('run-1', 1);
    await idle.supervisor.deliver('run-1', 7);
    expect(ofType(idle.dispatched, 'delegation.undelivered')).toEqual([
      { type: 'delegation.undelivered', runId: 'run-1', generation: 1, items: [] },
    ]);
    const refusing = createSessions({ refuseSteer: true });
    const refused = setup([createRun({ cohort: cohort('steer') }), finishedChild()], {
      startSession: refusing.startSession,
    });
    const running = refused.supervisor.execute('run-1');
    await until('the session', () => refusing.started.length === 1);
    await refused.supervisor.deliver('run-1', 1);
    expect(ofType(refused.dispatched, 'delegation.undelivered')).toEqual([
      { type: 'delegation.undelivered', runId: 'run-1', generation: 1, items: [] },
    ]);
    refusing.started[0]?.finish();
    await running;
  });
});

describe('waking a run that waits on its delegated tasks', () => {
  test('the report starts a turn, and counts as delivered once the session is linked', async () => {
    const sessions = createSessions();
    const context = setup(
      [createRun({ status: 'waiting', sessionId: 'old', cohort: cohort('wake') }), finishedChild()],
      { startSession: sessions.startSession }
    );
    const { supervisor, dispatched } = context;
    const waking = supervisor.wake('run-1', 1);
    await until('the session', () => sessions.started.length === 1);
    expect(sessions.started[0]?.input).toMatchObject({ resume: 'old' });
    expect(sessions.started[0]?.input.prompt).toContain('Found two greetings.');
    sessions.started[0]?.input.onSession('old');
    sessions.started[0]?.input.onSession('old');
    sessions.started[0]?.finish();
    await waking;
    expect(ofType(dispatched, 'delegation.delivered')).toEqual([
      { type: 'delegation.delivered', runId: 'run-1', generation: 1, items: ['result:child'] },
    ]);
    expect(ofType(dispatched, 'delegation.undelivered')).toEqual([]);
    expect(idsOf(context, 'delegation.delivered')).toEqual(['delegation.delivered:run-1:1']);
  });

  test('a wake whose session never starts hands the report back; a stale or needless wake does nothing', async () => {
    const sessions = createSessions();
    const context = setup([createRun({ status: 'waiting', cohort: cohort('wake') }), finishedChild()], {
      startSession: sessions.startSession,
    });
    const { supervisor, dispatched } = context;
    await supervisor.wake('run-1', 4);
    await supervisor.wake('missing', 1);
    expect(sessions.started).toHaveLength(0);
    const waking = supervisor.wake('run-1', 1);
    await until('the session', () => sessions.started.length === 1);
    await supervisor.wake('run-1', 1);
    sessions.started[0]?.finish({ outcome: 'failed', summary: 'crashed' });
    await waking;
    expect(ofType(dispatched, 'delegation.undelivered')).toEqual([
      { type: 'delegation.undelivered', runId: 'run-1', generation: 1, items: [] },
    ]);
    expect(idsOf(context, 'delegation.undelivered')).toEqual(['delegation.undelivered:run-1:1']);
  });

  test('a delivered report the engine refuses to record is logged, not lost', async () => {
    const sessions = createSessions();
    const { supervisor, reject } = setup(
      [createRun({ status: 'waiting', cohort: cohort('wake') }), finishedChild()],
      { startSession: sessions.startSession }
    );
    reject((command) => command.type === 'delegation.delivered');
    const warn = spyOn(log, 'warn');
    const waking = supervisor.wake('run-1', 1);
    await until('the session', () => sessions.started.length === 1);
    sessions.started[0]?.input.onSession('s');
    await until('the warning', () =>
      warn.mock.calls.some(([message]) => message === '[Runs] Could not record a delivered report')
    );
    warn.mockRestore();
    sessions.started[0]?.finish();
    await waking;
  });
});

describe('answering a delegated agent', () => {
  test('an answer to an agent whose turn ended starts a new turn with it; others are ignored', async () => {
    const sessions = createSessions();
    const question = {
      id: 'q',
      question: 'Which file?',
      context: null,
      choices: [],
      recommendation: null,
      askedAt: 1,
      delivered: true,
      answer: 'a.txt',
      answeredAt: 2,
    };
    const { supervisor } = setup(
      [
        createRun(),
        finishedChild({ endedAt: null, outcome: null, sessionId: 's', delegation: delegation({ question }) }),
        finishedChild({ id: 'over', delegation: delegation({ question }) }),
      ],
      { startSession: sessions.startSession }
    );
    await supervisor.replyToDelegate('missing', 'q');
    await supervisor.replyToDelegate('child', 'other');
    await supervisor.replyToDelegate('over', 'q');
    expect(sessions.started).toHaveLength(0);
    const replying = supervisor.replyToDelegate('child', 'q');
    await until('the session', () => sessions.started.length === 1);
    expect(sessions.started[0]?.input.prompt).toContain('Which file?');
    expect(sessions.started[0]?.input.prompt).toContain('a.txt');
    sessions.started[0]?.finish();
    await replying;
  });
});
