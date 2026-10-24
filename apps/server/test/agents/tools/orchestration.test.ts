import { describe, expect, test } from 'bun:test';
import {
  applyEvent,
  createState,
  decide,
  isDelegatedRun,
  type PlanDocument,
  type Run,
  type ShinsaCommand,
  type ShinsaEvent,
  type ShinsaState,
} from '@shinsa/core';
import {
  type DelegationOutcome,
  handleOrchestrationTool,
  type OrchestrationCall,
} from '../../../src/agents/tools/orchestration.ts';

const SPEC: PlanDocument = {
  goal: 'Ship it.',
  phases: [
    { title: 'Find it', detail: 'Find the overflow.' },
    { title: 'Fix it', detail: 'Clamp the width.' },
  ],
  behaviour: ['It works.'],
  approach: 'Carefully.',
  files: [],
  outOfScope: [],
  verification: ['The overflow test passes.'],
  questions: [],
};

function createCore() {
  let state = createState();
  let clock = 1_000;
  let counter = 0;
  const dispatched: ShinsaCommand[] = [];
  const dispatch = (command: ShinsaCommand): Promise<ShinsaEvent[]> => {
    dispatched.push(command);
    clock += 1;
    const decision = decide(state, command, { now: clock, newId: () => `id${++counter}` });
    const events = decision.events.map(
      (event) => ({ ...event, seq: state.seq + 1, at: clock }) as ShinsaEvent
    );
    for (const event of events) state = applyEvent(state, { ...event, seq: state.seq + 1 });
    return Promise.resolve(events);
  };
  return {
    dispatched,
    dispatch,
    get state(): ShinsaState {
      return state;
    },
  };
}

async function building(role: 'builder' | 'planner' = 'builder') {
  const core = createCore();
  for (const name of ['app', 'admin']) {
    await core.dispatch({
      type: 'repo.register',
      repo: {
        name,
        path: `/code/${name}`,
        defaultBranch: 'main',
        remote: null,
        checkCommands: ['bun test'],
      },
      projectName: null,
    });
  }
  const repoId = Object.values(core.state.repos).find((repo) => repo.name === 'app')?.id ?? '';
  await core.dispatch({ type: 'task.create', request: 'Fix the tab scroll', repoId });
  const taskId = Object.keys(core.state.tasks)[0] ?? '';
  await core.dispatch({
    type: 'task.triage',
    taskId,
    title: 'Fix the tab scroll',
    repoId,
    size: 'small',
    branch: 'fix/scroll',
    waitsOn: [],
  });
  await core.dispatch({ type: 'config.record', taskId, problems: [] });
  await core.dispatch({ type: 'worktree.ready', taskId, path: '/wt/scroll', branch: 'fix/scroll' });
  const planner = Object.values(core.state.runs)[0] as Run;
  if (role === 'builder')
    await core.dispatch({ type: 'agent.propose_plan', runId: planner.id, document: SPEC });
  const run = Object.values(core.state.runs).find((candidate) => candidate.endedAt === null) as Run;
  return { core, taskId, run };
}

interface Options {
  outcome?: DelegationOutcome;
  state?: () => ShinsaState;
  runId?: string;
  requestKey?: string;
}

function createCall(core: ReturnType<typeof createCore>, runId: string, options: Options = {}) {
  const started: string[] = [];
  const waits: number[] = [];
  const ids: (string | null)[] = [];
  let commits = 0;
  const call: OrchestrationCall = {
    runId: options.runId ?? runId,
    attemptId: '',
    requestKey: options.requestKey ?? Bun.randomUUIDv7(),
    signal: new AbortController().signal,
    minuteMs: 2,
    state: options.state ?? (() => core.state),
    dispatch: (command, id) => {
      ids.push(id ?? null);
      return core.dispatch(command);
    },
    resolveBaseCommit: () => {
      commits += 1;
      return Promise.resolve('abc1234');
    },
    hasProvider: (id) => id === 'claude',
    awaitDelegation: (_child, timeoutMs) => {
      waits.push(timeoutMs);
      return Promise.resolve(options.outcome ?? 'settled');
    },
    recordStarted: (childRunId) => {
      started.push(childRunId);
    },
  };
  return { call, started, waits, ids, commits: () => commits };
}

function parse(text: string | null) {
  return JSON.parse(text ?? 'null') as Record<string, unknown>;
}

function children(state: ShinsaState) {
  return Object.values(state.runs).filter(isDelegatedRun);
}

describe('delegate_task', () => {
  test('starts the task on the parent’s role, tells the chat, and returns its status at once', async () => {
    const { core, run } = await building();
    const { call, started } = createCall(core, run.id);
    const status = parse(await handleOrchestrationTool('delegate_task', { brief: 'Check the copy.' }, call));
    const [child] = children(core.state);
    expect(status).toEqual({
      delegation_id: child?.id,
      title: 'Check the copy.',
      role: 'builder',
      status: 'running',
      provider: 'claude',
      model: 'opus',
      depth: 1,
      isolation: 'shared',
      has_pending_question: false,
      question: null,
      delegations_running: 0,
      result: null,
      wait_timed_out: false,
    });
    expect(started).toEqual([child?.id ?? '']);
  });

  test('the same client_request_id returns the same task, without a second checkout or chat line', async () => {
    const { core, run } = await building();
    const { call, started, commits } = createCall(core, run.id);
    const input = { brief: 'Try it.', isolation: 'worktree', client_request_id: 'try-1', role: 'builder' };
    const first = parse(await handleOrchestrationTool('delegate_task', input, call));
    const second = parse(await handleOrchestrationTool('delegate_task', input, call));
    expect(second.delegation_id).toBe(first.delegation_id);
    expect(children(core.state)).toHaveLength(1);
    expect(children(core.state)[0]?.delegation.baseCommit).toBe('abc1234');
    expect(commits()).toBe(1);
    expect(started).toHaveLength(1);
  });

  test('a call repeated without a client_request_id finds the task and the courier it already made', async () => {
    const { core, run } = await building();
    const { call } = createCall(core, run.id, { requestKey: 'call:a1:7' });
    const first = parse(await handleOrchestrationTool('delegate_task', { brief: 'Try it.' }, call));
    const second = parse(await handleOrchestrationTool('delegate_task', { brief: 'Try it.' }, call));
    expect(second.delegation_id).toBe(first.delegation_id);
    expect(children(core.state)).toHaveLength(1);
    await handleOrchestrationTool('create_task', { request: 'Add it.' }, call);
    expect(await handleOrchestrationTool('create_task', { request: 'Add it.' }, call)).toContain(
      '- [Add it.]'
    );
  });

  test('names the command after the attempt and the client request id, so a repeat is answered by its receipt', async () => {
    const { core, run } = await building();
    const { call, ids } = createCall(core, run.id);
    await handleOrchestrationTool('delegate_task', { brief: 'Try it.', client_request_id: 'try-1' }, call);
    await handleOrchestrationTool('delegate_task', { brief: 'Try another.' }, call);
    await handleOrchestrationTool('create_task', { request: 'Add it.', client_request_id: 'c1' }, call);
    expect(ids).toEqual([`agent:${run.id}::delegate:try-1`, null, `agent:${run.id}::create_task:c1`]);
  });

  test('refuses a provider Shinsa does not have', async () => {
    const { core, run } = await building();
    const { call } = createCall(core, run.id);
    await expect(
      handleOrchestrationTool('delegate_task', { brief: 'Try it.', provider: 'nope' }, call)
    ).rejects.toThrow('There is no agent provider "nope". Leave provider unset to use the default.');
  });

  test('passes the core’s refusal through: a planner cannot delegate a builder', async () => {
    const { core, run } = await building('planner');
    const { call } = createCall(core, run.id);
    await expect(
      handleOrchestrationTool('delegate_task', { brief: 'Build it.', role: 'builder' }, call)
    ).rejects.toThrow('A planner cannot change files');
    const status = parse(await handleOrchestrationTool('delegate_task', { brief: 'Research it.' }, call));
    expect(status.role).toBe('planner');
  });

  test('a wait gets its time limit in minutes and returns the task as it stands when the wait ends', async () => {
    const { core, run } = await building();
    const { call, waits } = createCall(core, run.id, { outcome: 'settled' });
    const pending = handleOrchestrationTool(
      'delegate_task',
      { brief: 'Review it.', role: 'reviewer', mode: 'wait', timeout_minutes: 3 },
      call
    );
    const status = parse(await pending);
    expect(waits).toEqual([6]);
    expect(status.status).toBe('running');
    const child = children(core.state)[0];
    expect(child?.delegation.mode).toBe('wait');
  });

  test('a wait that ends on a finished task returns its result', async () => {
    const { core, run } = await building();
    const { call } = createCall(core, run.id);
    await handleOrchestrationTool(
      'delegate_task',
      { brief: 'Review it.', role: 'reviewer', client_request_id: 'r' },
      call
    );
    const child = children(core.state)[0] as Run;
    await core.dispatch({ type: 'run.end', runId: child.id, outcome: 'completed', summary: 'Looks right.' });
    const status = parse(
      await handleOrchestrationTool(
        'delegate_task',
        { brief: 'Review it.', role: 'reviewer', client_request_id: 'r', mode: 'wait' },
        createCall(core, run.id).call
      )
    );
    expect(status).toMatchObject({ status: 'completed', result: 'Looks right.' });
    expect(core.state.runs[child.id]?.delegation?.delivery).toBe('acknowledged');
  });

  test('a wait that times out switches the task to waking the parent', async () => {
    const { core, run } = await building();
    const { call } = createCall(core, run.id, { outcome: 'timeout' });
    const status = parse(
      await handleOrchestrationTool('delegate_task', { brief: 'Run it.', mode: 'wait' }, call)
    );
    expect(status).toMatchObject({ status: 'running', wait_timed_out: true });
    expect(children(core.state)[0]?.delegation.wake).toBe('always');
  });

  test('a wait that ends on a question returns it', async () => {
    const { core, run } = await building();
    const { call } = createCall(core, run.id);
    await handleOrchestrationTool('delegate_task', { brief: 'Port it.', client_request_id: 'q' }, call);
    const child = children(core.state)[0] as Run;
    await core.dispatch({
      type: 'agent.ask',
      runId: child.id,
      gateId: 'q-1',
      question: 'Keep the old API?',
      context: 'Two callers.',
      choices: ['Keep', 'Drop'],
    });
    const status = parse(
      await handleOrchestrationTool(
        'delegate_task',
        { brief: 'Port it.', client_request_id: 'q', mode: 'wait' },
        createCall(core, run.id, { outcome: 'question' }).call
      )
    );
    expect(status).toMatchObject({
      status: 'waiting',
      has_pending_question: true,
      question: { question: 'Keep the old API?', context: 'Two callers.', choices: ['Keep', 'Drop'] },
    });
    expect(core.state.runs[child.id]?.delegation?.question?.delivered).toBe(true);
  });

  test('a run that no longer exists is told to end its turn', async () => {
    const { core, run } = await building();
    const { call } = createCall(core, run.id, { runId: 'gone' });
    await expect(handleOrchestrationTool('delegate_task', { brief: 'Try it.' }, call)).rejects.toThrow(
      'This run no longer exists. End your turn.'
    );
  });

  test('a delegation the core declined to make is reported', async () => {
    const { core, run } = await building();
    const { call } = createCall(core, run.id, { state: () => createState() });
    call.dispatch = () => Promise.resolve([]);
    call.state = () => ({ ...core.state, runs: { [run.id]: run } });
    await expect(handleOrchestrationTool('delegate_task', { brief: 'Try it.' }, call)).rejects.toThrow(
      'Nothing was delegated. Try again.'
    );
  });
});

describe('delegation_status, delegation_cancel and delegation_answer', () => {
  async function delegated() {
    const setup = await building();
    const { call } = createCall(setup.core, setup.run.id);
    const status = parse(
      await handleOrchestrationTool('delegate_task', { brief: 'Check it.', role: 'reviewer' }, call)
    );
    return { ...setup, call, childId: String(status.delegation_id) };
  }

  test('delegation_status reads a delegation, and reading a finished one counts as receiving it', async () => {
    const { core, call, childId } = await delegated();
    expect(
      parse(await handleOrchestrationTool('delegation_status', { delegation_id: childId }, call)).status
    ).toBe('running');
    await core.dispatch({ type: 'run.end', runId: childId, outcome: 'completed', summary: 'Fine.' });
    expect(
      parse(await handleOrchestrationTool('delegation_status', { delegation_id: childId }, call))
    ).toMatchObject({
      status: 'completed',
      result: 'Fine.',
    });
    expect(core.state.runs[childId]?.delegation?.delivery).toBe('acknowledged');
  });

  test('another run’s delegation is refused by name', async () => {
    const { call } = await delegated();
    await expect(
      handleOrchestrationTool('delegation_status', { delegation_id: 'nope' }, call)
    ).rejects.toThrow('You started no delegation nope. Use the delegation_id that delegate_task returned.');
    await expect(handleOrchestrationTool('delegation_status', {}, call)).rejects.toThrow(
      'delegation_id is required.'
    );
  });

  test('delegation_cancel stops the delegation and returns it stopped', async () => {
    const { call, childId } = await delegated();
    expect(
      parse(await handleOrchestrationTool('delegation_cancel', { delegation_id: childId }, call)).status
    ).toBe('cancelled');
  });

  test('delegation_answer answers the open question', async () => {
    const { core, call, childId } = await delegated();
    await core.dispatch({
      type: 'agent.ask',
      runId: childId,
      gateId: 'q-1',
      question: 'Which?',
      context: null,
    });
    expect(
      await handleOrchestrationTool(
        'delegation_answer',
        { delegation_id: childId, answer: 'The first.' },
        call
      )
    ).toBe('Answered. The agent carries on, and its result arrives here when it finishes.');
    expect(core.state.runs[childId]?.delegation?.question?.answer).toBe('The first.');
  });
});

describe('create_task and split_task', () => {
  test('create_task makes a task and returns a link to it', async () => {
    const { core, run, taskId } = await building();
    const { call } = createCall(core, run.id);
    const reply = await handleOrchestrationTool(
      'create_task',
      { request: 'Add the banner to the admin app.', repository: 'admin', client_request_id: 'c1' },
      call
    );
    const created = Object.values(core.state.tasks).find((task) => task.createdBy?.taskId === taskId);
    expect(reply).toBe(
      `Created. Link it for the human with:\n- [Add the banner to the admin app.](shinsa://task/${created?.id})`
    );
    expect(core.state.repos[created?.repoId ?? '']?.name).toBe('admin');
    await handleOrchestrationTool('create_task', { request: 'Same repo.', repository: 'app' }, call);
    expect(Object.values(core.state.tasks).find((task) => task.request === 'Same repo.')?.repoId).toBe(
      core.state.tasks[taskId]?.repoId ?? ''
    );
  });

  test('create_task refuses a repository Shinsa does not know, naming the ones it does', async () => {
    const { core, run } = await building();
    await expect(
      handleOrchestrationTool(
        'create_task',
        { request: 'Do it.', repository: 'web' },
        createCall(core, run.id).call
      )
    ).rejects.toThrow('There is no repository "web". Known: app, admin.');
    const empty = createCall(core, run.id, { state: () => ({ ...core.state, repos: {} }) }).call;
    await expect(
      handleOrchestrationTool('create_task', { request: 'Do it.', repository: 'web' }, empty)
    ).rejects.toThrow('Known: none.');
  });

  test('a run whose task is gone is told to end its turn', async () => {
    const { core, run } = await building();
    const { call } = createCall(core, run.id, { state: () => ({ ...core.state, tasks: {} }) });
    await expect(handleOrchestrationTool('create_task', { request: 'Do it.' }, call)).rejects.toThrow(
      'This task no longer exists. End your turn.'
    );
  });

  test('split_task makes the sub-tasks once and returns them every time', async () => {
    const { core, run } = await building();
    const { call } = createCall(core, run.id);
    const input = { tasks: [{ request: 'Port the header.' }, { request: 'Port the footer.' }] };
    const reply = await handleOrchestrationTool('split_task', input, call);
    expect(reply?.split('\n')).toHaveLength(3);
    expect(reply).toContain('- [Port the header.](shinsa://task/');
    expect(await handleOrchestrationTool('split_task', { tasks: [{ request: 'Other.' }] }, call)).toBe(reply);
  });

  test('a tool it does not know is not its to answer', async () => {
    const { core, run } = await building();
    expect(await handleOrchestrationTool('wait_for', {}, createCall(core, run.id).call)).toBeNull();
  });
});
