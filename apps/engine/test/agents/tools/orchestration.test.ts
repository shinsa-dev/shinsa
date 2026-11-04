import { describe, expect, test } from 'bun:test';
import {
  applyEvent,
  createState,
  decide,
  isDelegatedRun,
  type PlanDocument,
  type Repo,
  type Run,
  type ShinsaCommand,
  type ShinsaEvent,
  type ShinsaState,
  type Task,
  type TeamFeedTask,
} from '@shinsa/core';
import { Duration, Effect, Result } from 'effect';
import { handleOrchestrationTool as handleTool } from '../../../src/agents/tools/orchestration/handler.ts';
import type { DelegationOutcome, OrchestrationCall } from '../../../src/agents/tools/orchestration/schema.ts';
import { ToolCallFailed } from '../../../src/agents/tools/schema.ts';
import { describeError } from '../../../src/log/index.ts';

type RegisterRepo = (projectId: string | null, name: string) => Promise<Repo | null>;

type CreateRepo = (projectId: string, name: string) => Promise<Repo>;

function attempt<A>(run: () => Promise<A>) {
  return Effect.tryPromise({
    try: run,
    catch: (error) => new ToolCallFailed({ message: describeError(error) }),
  });
}

function handleOrchestrationTool(name: string, input: Record<string, unknown>, call: OrchestrationCall) {
  return Effect.runPromise(handleTool(name, input, call));
}

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
  verification: [{ label: 'Overflow test', command: 'bun test test/overflow.test.ts', phases: [2] }],
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
    const decision = Result.getOrThrow(decide(state, command, { now: clock, newId: () => `id${++counter}` }));
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

async function building(purpose: 'build' | 'plan' = 'build') {
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
  const planning = Object.values(core.state.runs)[0] as Run;
  if (purpose === 'build')
    await core.dispatch({ type: 'agent.propose_plan', runId: planning.id, document: SPEC });
  const run = Object.values(core.state.runs).find((candidate) => candidate.endedAt === null) as Run;
  return { core, taskId, run };
}

interface Options {
  outcome?: DelegationOutcome;
  state?: () => ShinsaState;
  runId?: string;
  requestKey?: string;
  registerRepo?: RegisterRepo;
  createRepo?: CreateRepo;
  teamTasks?: () => readonly TeamFeedTask[];
}

function createCall(core: ReturnType<typeof createCore>, runId: string, options: Options = {}) {
  const started: string[] = [];
  const waits: number[] = [];
  const ids: (string | null)[] = [];
  let commits = 0;
  const registerRepo = options.registerRepo ?? (() => Promise.resolve(null));
  const createRepo =
    options.createRepo ?? (() => Promise.reject(new Error('No repository is created here.')));
  const state = options.state ?? (() => core.state);
  const call: OrchestrationCall = {
    runId: options.runId ?? runId,
    attemptId: '',
    requestKey: options.requestKey ?? Bun.randomUUIDv7(),
    signal: new AbortController().signal,
    minute: Duration.millis(2),
    state: Effect.sync(state),
    teamTasks: Effect.sync(options.teamTasks ?? (() => [])),
    dispatch: (command, id) => {
      ids.push(id ?? null);
      return attempt(() => core.dispatch(command));
    },
    resolveBaseCommit: Effect.sync(() => {
      commits += 1;
      return 'abc1234';
    }),
    registerRepo: (projectId, name) => attempt(() => registerRepo(projectId, name)),
    createRepo: (projectId, name) => attempt(() => createRepo(projectId, name)),
    hasProvider: (id) => id === 'claude',
    awaitDelegation: (_child, timeout) =>
      Effect.sync(() => {
        waits.push(Duration.toMillis(timeout));
        return options.outcome ?? 'settled';
      }),
    recordStarted: (childRunId) => Effect.sync(() => void started.push(childRunId)),
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
  test('starts a builder for a building agent, tells the chat, and returns its status at once', async () => {
    const { core, run } = await building();
    expect(run).toMatchObject({ role: 'agent', purpose: 'build' });
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

  test('passes the core’s refusal through: an agent that is planning cannot delegate a builder', async () => {
    const { core, run } = await building('plan');
    expect(run).toMatchObject({ role: 'agent', purpose: 'plan' });
    const { call } = createCall(core, run.id);
    await expect(
      handleOrchestrationTool('delegate_task', { brief: 'Build it.', role: 'builder' }, call)
    ).rejects.toThrow('While you plan you cannot change files');
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
    const { call } = createCall(core, run.id);
    const declined: OrchestrationCall = {
      ...call,
      dispatch: () => Effect.succeed([]),
      state: Effect.sync(() => ({ ...core.state, runs: { [run.id]: run } })),
    };
    await expect(handleOrchestrationTool('delegate_task', { brief: 'Try it.' }, declined)).rejects.toThrow(
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

  test('create_task forks the task it names by id or handle, and refuses one it does not know', async () => {
    const { core, run, taskId } = await building();
    const { call } = createCall(core, run.id);
    await handleOrchestrationTool(
      'create_task',
      { request: 'Fix it in Safari.', fork_from: taskId, client_request_id: 'f1' },
      call
    );
    const byId = Object.values(core.state.tasks).find((task) => task.request === 'Fix it in Safari.');
    expect(byId?.forkOf).toBe(taskId);
    const handle = core.state.tasks[taskId]?.handle ?? '';
    expect(handle).not.toBe('');
    await handleOrchestrationTool(
      'create_task',
      { request: 'Fix it in Firefox.', fork_from: handle.toLowerCase(), client_request_id: 'f2' },
      call
    );
    expect(
      Object.values(core.state.tasks).find((task) => task.request === 'Fix it in Firefox.')?.forkOf
    ).toBe(taskId);
    await handleOrchestrationTool('create_task', { request: 'Unrelated.', client_request_id: 'f3' }, call);
    expect(
      Object.values(core.state.tasks).find((task) => task.request === 'Unrelated.')?.forkOf
    ).toBeUndefined();
    await expect(
      handleOrchestrationTool('create_task', { request: 'Do it.', fork_from: 'LOC-999' }, call)
    ).rejects.toThrow('There is no task "LOC-999" to fork.');
  });

  test('create_task forks a teammate’s task onto this machine, into the repository with its remote', async () => {
    const { core, run, taskId } = await building();
    const source = core.state.tasks[taskId];
    const theirs = { ...(source as Task), id: 'kai-task', handle: 'PAY-1', title: 'Retry payments' };
    const repo = core.state.repos[source?.repoId ?? ''] ?? null;
    const teamTask = (remote: string | null, name: string) => ({
      task: theirs,
      gates: [],
      project: null,
      repo: repo ? { ...repo, id: 'kai-repo', name, remote } : null,
      owner: 'kai',
      ownerProfile: { name: 'Kai', avatarUrl: null },
      machine: 'Kai’s MacBook',
      teamId: 'core',
      instanceId: 'kai-macbook',
    });
    const { call } = createCall(core, run.id, { teamTasks: () => [teamTask(null, 'app')] });
    await handleOrchestrationTool(
      'create_task',
      { request: 'Retry twice.', fork_from: 'pay-1', client_request_id: 't1' },
      call
    );
    const fork = Object.values(core.state.tasks).find((task) => task.request === 'Retry twice.');
    expect(fork?.forkOf).toBeUndefined();
    expect(fork?.teammateFork).toMatchObject({ instanceId: 'kai-macbook', taskId: 'kai-task', owner: 'Kai' });
    expect(fork?.repoId).toBe(source?.repoId ?? '');
    const elsewhere = createCall(core, run.id, { teamTasks: () => [teamTask(null, 'admin')] });
    await handleOrchestrationTool(
      'create_task',
      { request: 'Retry thrice.', fork_from: 'kai-task', client_request_id: 't2' },
      elsewhere.call
    );
    const admin = Object.values(core.state.tasks).find((task) => task.request === 'Retry thrice.');
    expect(admin?.teammateFork?.taskId).toBe('kai-task');
    expect(core.state.repos[admin?.repoId ?? '']?.name).toBe('admin');
  });

  test('create_task with after_this makes the new task wait for this one to merge', async () => {
    const { core, run, taskId } = await building();
    const { call } = createCall(core, run.id);
    await handleOrchestrationTool(
      'create_task',
      { request: 'Use the new endpoint in the admin app.', repository: 'admin', after_this: true },
      call
    );
    const created = Object.values(core.state.tasks).find((task) => task.createdBy?.taskId === taskId);
    expect(created?.waitsOn).toEqual([taskId]);
    expect(core.state.tasks[taskId]?.waitsOn).toEqual([]);
  });

  test('create_task with stack_on_this stacks the new task on this one as a bundle', async () => {
    const { core, run, taskId } = await building();
    const { call } = createCall(core, run.id);
    await handleOrchestrationTool(
      'create_task',
      { request: 'Show the new endpoint in the settings page.', stack_on_this: true },
      call
    );
    const created = Object.values(core.state.tasks).find((task) => task.createdBy?.taskId === taskId);
    expect(created).toMatchObject({ stacksOn: [taskId], waitsOn: [] });
  });

  test('create_task with stack_on stacks the new task on other tasks too', async () => {
    const { core, run, taskId } = await building();
    const repoId = core.state.tasks[taskId]?.repoId ?? null;
    await core.dispatch({ type: 'task.create', request: 'Add the second endpoint', repoId });
    const other = Object.values(core.state.tasks).find((task) => task.id !== taskId);
    const { call } = createCall(core, run.id);
    await handleOrchestrationTool(
      'create_task',
      { request: 'Join both endpoints.', stack_on_this: true, stack_on: [other?.id ?? ''] },
      call
    );
    const created = Object.values(core.state.tasks).find((task) => task.createdBy?.taskId === taskId);
    expect(created).toMatchObject({ stacksOn: [taskId, other?.id] });
    await expect(
      handleOrchestrationTool(
        'create_task',
        { request: 'Join.', stack_on: ['LOC-404'], client_request_id: 'again' },
        createCall(core, run.id).call
      )
    ).rejects.toThrow('There is no task "LOC-404" to stack on.');
  });

  test('create_task refuses a repository Shinsa does not know, naming the ones it does', async () => {
    const { core, run } = await building();
    await expect(
      handleOrchestrationTool(
        'create_task',
        { request: 'Do it.', repository: 'web' },
        createCall(core, run.id).call
      )
    ).rejects.toThrow(
      'There is no repository "web" in Shinsa or in the project\'s folders. Known: app, admin. Set new_repository to create it.'
    );
    const empty = createCall(core, run.id, { state: () => ({ ...core.state, repos: {} }) }).call;
    await expect(
      handleOrchestrationTool('create_task', { request: 'Do it.', repository: 'web' }, empty)
    ).rejects.toThrow('Known: none.');
  });

  test('create_task registers a repository it names from the project folders, and files the task there', async () => {
    const { core, run, taskId } = await building();
    const named: string[] = [];
    const registerRepo: RegisterRepo = async (projectId, name) => {
      named.push(`${projectId}:${name}`);
      await core.dispatch({
        type: 'repo.register',
        repo: { name, path: `/code/${name}`, defaultBranch: 'main', remote: null, checkCommands: [] },
        projectName: null,
      });
      return Object.values(core.state.repos).find((repo) => repo.name === name) ?? null;
    };
    const { call } = createCall(core, run.id, { registerRepo });
    await handleOrchestrationTool(
      'create_task',
      { request: 'Document the agent login.', repository: 'docs', after_this: true },
      call
    );
    const docs = Object.values(core.state.repos).find((repo) => repo.name === 'docs');
    const created = Object.values(core.state.tasks).find((task) => task.createdBy?.taskId === taskId);
    expect(named).toEqual(['null:docs']);
    expect(created).toMatchObject({ repoId: docs?.id, waitsOn: [taskId] });
    await handleOrchestrationTool('create_task', { request: 'More docs.', repository: 'docs' }, call);
    expect(named).toHaveLength(1);
  });

  async function inProject() {
    const building_ = await building();
    const { core } = building_;
    await core.dispatch({ type: 'project.write', project: { name: 'Shinsa', color: 'blue', key: 'LOC' } });
    await core.dispatch({ type: 'project.write', project: { name: 'Islands', color: 'green', key: 'ISL' } });
    const project = (name: string) =>
      Object.values(core.state.projects).find((candidate) => candidate.name === name)?.id ?? '';
    for (const repo of Object.values(core.state.repos)) {
      await core.dispatch({ type: 'repo.update', repoId: repo.id, patch: { projectId: project('Shinsa') } });
    }
    return { ...building_, shinsa: project('Shinsa'), islands: project('Islands') };
  }

  function createRepoIn(core: ReturnType<typeof createCore>, made: string[]): CreateRepo {
    return async (projectId, name) => {
      made.push(`${projectId}:${name}`);
      await core.dispatch({
        type: 'repo.register',
        repo: { name, path: `/new/${name}`, defaultBranch: 'main', remote: null, checkCommands: [] },
        projectName: null,
        projectId,
      });
      const repo = Object.values(core.state.repos).find((candidate) => candidate.path === `/new/${name}`);
      if (!repo) throw new Error('not registered');
      return repo;
    };
  }

  test('create_task with new_repository creates the repository in the project and files the task there', async () => {
    const { core, run, taskId, shinsa } = await inProject();
    const made: string[] = [];
    const { call } = createCall(core, run.id, { createRepo: createRepoIn(core, made) });
    const input = { request: 'Start the islands app.', repository: 'islands', new_repository: true };
    await handleOrchestrationTool('create_task', input, call);
    const islands = Object.values(core.state.repos).find((repo) => repo.name === 'islands');
    const created = Object.values(core.state.tasks).find((task) => task.createdBy?.taskId === taskId);
    expect(made).toEqual([`${shinsa}:islands`]);
    expect(created).toMatchObject({ repoId: islands?.id, projectId: shinsa });
    await handleOrchestrationTool('create_task', { ...input, client_request_id: 'again' }, call);
    expect(made).toHaveLength(1);
  });

  test('create_task with project files the task in that project, creating the repository there when asked', async () => {
    const { core, run, taskId, islands } = await inProject();
    const made: string[] = [];
    const { call } = createCall(core, run.id, { createRepo: createRepoIn(core, made) });
    await handleOrchestrationTool(
      'create_task',
      { request: 'Plan the islands app.', project: 'isl', client_request_id: 'plan' },
      call
    );
    await handleOrchestrationTool(
      'create_task',
      {
        request: 'Start it.',
        project: 'Islands',
        repository: 'app',
        new_repository: true,
        client_request_id: 'app',
      },
      call
    );
    const created = Object.values(core.state.tasks).filter((task) => task.createdBy?.taskId === taskId);
    const app = Object.values(core.state.repos).find(
      (repo) => repo.name === 'app' && repo.projectId === islands
    );
    expect(made).toEqual([`${islands}:app`]);
    expect(created.map((task) => ({ repoId: task.repoId, projectId: task.projectId }))).toEqual([
      { repoId: null, projectId: islands },
      { repoId: app?.id ?? '', projectId: islands },
    ]);
  });

  test('create_task refuses a project it does not know, and a new repository with no name or no project', async () => {
    const { core, run } = await building();
    const { call } = createCall(core, run.id);
    await expect(
      handleOrchestrationTool('create_task', { request: 'Do it.', project: 'Nowhere' }, call)
    ).rejects.toThrow('There is no project "Nowhere". Known: none.');
    await expect(
      handleOrchestrationTool('create_task', { request: 'Do it.', new_repository: true }, call)
    ).rejects.toThrow('Set repository to the name of the repository to create.');
    await expect(
      handleOrchestrationTool(
        'create_task',
        { request: 'Do it.', repository: 'web', new_repository: true },
        call
      )
    ).rejects.toThrow('This task belongs to no project, so there is no folder to create the repository in.');
    const named = await inProject();
    await expect(
      handleOrchestrationTool(
        'create_task',
        { request: 'Do it.', project: 'Nowhere' },
        createCall(named.core, named.run.id).call
      )
    ).rejects.toThrow('Known: Shinsa (LOC), Islands (ISL).');
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

  test('split_task with stacked chains the parts as a bundle on this task', async () => {
    const { core, run } = await building();
    const { call } = createCall(core, run.id);
    const input = { tasks: [{ request: 'Move the store.' }, { request: 'Move the views.' }], stacked: true };
    await handleOrchestrationTool('split_task', input, call);
    const parts = Object.values(core.state.tasks).filter((task) => task.parentTaskId === run.taskId);
    const store = parts.find((task) => task.request === 'Move the store.');
    const views = parts.find((task) => task.request === 'Move the views.');
    expect(store?.stacksOn).toEqual([run.taskId]);
    expect(views?.stacksOn).toEqual([store?.id ?? '']);
  });

  test('a tool it does not know is not its to answer', async () => {
    const { core, run } = await building();
    expect(await handleOrchestrationTool('wait_for', {}, createCall(core, run.id).call)).toBeNull();
  });
});
