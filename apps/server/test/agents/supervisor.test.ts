import { describe, expect, test } from 'bun:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ShinsaState } from '@shinsa/core';
import type { ClaudeSession, ClaudeSessionInput } from '../../src/agents/claude/index.ts';
import { RunSupervisor, type SupervisorOptions, Transcripts } from '../../src/agents/index.ts';
import { EvidenceStore } from '../../src/store/index.ts';
import { createGitRepo, createTempDir, createTestConfig, git, until, writeFiles } from '../helpers/index.ts';
import { createGate, createRepo, createRun, createStubEngine, createTask } from '../helpers/state.ts';

interface FakeSession {
  input: ClaudeSessionInput;
  session: ClaudeSession;
  finish: (outcome?: 'completed' | 'failed') => void;
  steers: string[];
  cancelled: boolean;
}

function createSessions(options: { cancelFails?: boolean; throwOnStart?: boolean } = {}) {
  const started: FakeSession[] = [];
  const startSession = (input: ClaudeSessionInput): ClaudeSession => {
    if (options.throwOnStart) throw new Error('claude is not installed');
    const done = Promise.withResolvers<{
      outcome: 'completed' | 'failed' | 'cancelled';
      summary: string | null;
    }>();
    const fake: FakeSession = {
      input,
      steers: [],
      cancelled: false,
      finish: (outcome = 'completed') => done.resolve({ outcome, summary: outcome }),
      session: {
        done: done.promise,
        steer: (text) => {
          fake.steers.push(text);
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

function endedRuns(dispatched: { type: string }[]) {
  return dispatched.filter((command) => command.type === 'run.end');
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
      role: 'builder',
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
    expect(dispatched.map((command) => command.type)).toEqual(['run.link', 'run.end']);
    expect(endedRuns(dispatched)[0]).toMatchObject({ outcome: 'completed' });
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

  test('edits by a reviewer are set aside, and a stash that fails is only logged', async () => {
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
    const second = setup(withTask(empty, [createRun({ role: 'planner' })]), {
      startSession: planner.startSession,
    });
    const planning = second.supervisor.execute('run-1');
    await until('the planner', () => planner.started.length === 1);
    planner.started[0]?.finish();
    await planning;
    expect(endedRuns(second.dispatched)).toHaveLength(1);
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
        createRun({ id: 'run-2', role: 'fixer' }),
        createRun({ id: 'run-3', role: 'fixer' }),
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
      state.runs['run-3'] = createRun({ id: 'run-3', role: 'fixer', endedAt: 9 });
    });
    sessions.started[0]?.finish();
    await first;
    await until('the second session', () => sessions.started.length === 2);
    sessions.started[1]?.finish();
    await Promise.all([second, third]);
    expect(sessions.started.map((fake) => fake.input.role)).toEqual(['builder', 'fixer']);
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
    const { supervisor, dispatched, reject } = setup(
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
    await supervisor.recover();
    await until('two sessions', () => sessions.started.length === 2);
    expect(sessions.started.map((fake) => [fake.input.prompt.length > 0, fake.input.resume])).toEqual([
      [true, 'sess-1'],
      [true, null],
    ]);
    expect(dispatched.at(-1)).toEqual({ type: 'runs.dispatch' });
    for (const fake of sessions.started) fake.finish();
  });
});

describe('questions', () => {
  function askingSetup(maxRunMs?: number) {
    const sessions = createSessions();
    const context = setup(withTask(createTempDir()), { startSession: sessions.startSession, maxRunMs });
    const running = context.supervisor.execute('run-1');
    const ready = until('the session', () => sessions.started.length === 1);
    return { ...context, sessions, running, ready };
  }

  test('an answer reaches the waiting tool call, and overlapping questions keep the clock stopped', async () => {
    const { supervisor, sessions, running, ready, dispatched, update } = askingSetup(60);
    await ready;
    const { input, finish } = sessions.started[0] as FakeSession;
    const signal = new AbortController().signal;
    const first = input.handleTool('ask', { question: 'Blue or green?' }, signal);
    const second = input.handleTool('ask', { question: 'Tabs or spaces?', context: 'Style' }, signal);
    await until(
      'both questions',
      () => dispatched.filter((command) => command.type === 'agent.ask').length === 2
    );
    await Bun.sleep(100);
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

  test('a question needs text, a stopped step cannot ask, and a refused question is not left waiting', async () => {
    const { sessions, running, ready, reject } = askingSetup();
    await ready;
    const { input, finish } = sessions.started[0] as FakeSession;
    const live = new AbortController();
    expect(input.handleTool('ask', {}, live.signal)).rejects.toThrow('question is required.');
    const aborted = new AbortController();
    aborted.abort();
    expect(input.handleTool('ask', { question: 'x' }, aborted.signal)).rejects.toThrow(
      'This step was stopped.'
    );
    reject((command) => command.type === 'agent.ask', new Error('gate refused'));
    expect(input.handleTool('ask', { question: 'x' }, live.signal)).rejects.toThrow('gate refused');
    finish();
    await running;
  });

  test('a session that stops while waiting withdraws its question', async () => {
    const { sessions, running, ready, dispatched } = askingSetup();
    await ready;
    const { input, finish } = sessions.started[0] as FakeSession;
    const controller = new AbortController();
    const asked = input.handleTool('ask', { question: 'x' }, controller.signal);
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
});

describe('hand-overs', () => {
  async function handOverSetup(patch?: (state: ShinsaState) => void) {
    const { path } = await createGitRepo({ remote: false });
    const sessions = createSessions();
    const context = setup(
      (state) => {
        withTask(path)(state);
        patch?.(state);
      },
      { startSession: sessions.startSession }
    );
    const running = context.supervisor.execute('run-1');
    await until('the session', () => sessions.started.length === 1);
    const fake = sessions.started[0] as FakeSession;
    const call = (name: string, input: Record<string, unknown> = {}) =>
      fake.input.handleTool(name, input, new AbortController().signal);
    return { ...context, path, call, done: () => fake.finish(), running };
  }

  test('a phase is committed then handed over, a fix likewise, and a review is reported', async () => {
    const { call, path, dispatched, done, running } = await handOverSetup();
    writeFiles(path, { 'a.txt': 'a' });
    const phase = { summary: 'Wrote `a.txt`.', spots: [], decisions: [] };
    expect(await call('complete_phase', phase)).toBe('Handed over to Shinsa. End your turn now.');
    expect(await git(path, 'log', '-1', '--format=%s')).toBe('fix: the tab scroll');
    expect(await call('complete_fix', { summary: 'Fixed.' })).toContain('Handed over');
    expect(await call('report_review', { findings: [] })).toContain('Handed over');
    expect(call('propose_plan', { goal: '' })).rejects.toThrow('Shinsa rejected this hand-over.');
    expect(
      await call('propose_plan', {
        goal: 'Add the files.',
        plan: [
          { title: 'Write a', detail: 'Create a.txt.' },
          { title: 'Write b', detail: 'Create b.txt.' },
        ],
        behaviour: ['Both exist.'],
        approach: 'Write them.',
        files: [],
        out_of_scope: [],
        verification: ['The checks pass.'],
        questions: [],
      })
    ).toContain('Handed over');
    expect(dispatched.map((command) => command.type).slice(0, 3)).toEqual([
      'agent.complete_phase',
      'agent.complete_fix',
      'agent.report_review',
    ]);
    done();
    await running;
  });

  test('evidence, notes and task lookups', async () => {
    const { call, path, dispatched, done, running } = await handOverSetup();
    writeFiles(path, { 'shot.png': 'png' });
    expect(await call('attach_evidence', { kind: 'screenshot', title: 'Home', path: 'shot.png' })).toBe(
      'Attached.'
    );
    expect(dispatched.at(-1)).toMatchObject({
      type: 'agent.attach_evidence',
      kind: 'screenshot',
      title: 'Home',
    });
    expect(await call('note', { note: 'Follow up on dark mode.' })).toBe('Noted.');
    expect(call('note', {})).rejects.toThrow('note is required.');
    expect(await call('find_tasks', { query: 'tab' })).toContain('Fix the tab scroll');
    expect(await call('find_tasks')).toContain('Fix the tab scroll');
    expect(call('launch_rockets')).rejects.toThrow('Unknown tool launch_rockets.');
    done();
    await running;
  });

  test('a hand-over from a run that is over or gone is refused, and a task without a worktree commits nothing', async () => {
    const { call, update, done, running } = await handOverSetup();
    update((state) => {
      state.tasks['task-1'] = createTask({ worktreePath: null });
    });
    expect(await call('complete_fix', { summary: 'Fixed.' })).toContain('Handed over');
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
    fake.input.handleTool('attach_evidence', { text: 'log' }, new AbortController().signal)
  ).rejects.toThrow();
  fake.finish();
  await running;
});
