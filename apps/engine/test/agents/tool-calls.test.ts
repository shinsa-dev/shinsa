import { afterEach, describe, expect, test } from 'bun:test';
import { isDelegatedRun, type PlanDocument, type Run, type ShinsaState } from '@shinsa/core';
import { Duration, Effect, Layer } from 'effect';
import { Providers } from '../../src/agents/providers/index.ts';
import { ToolCallsLayer } from '../../src/agents/tool-calls/layers.ts';
import { DelegationMinute, type ToolCall } from '../../src/agents/tool-calls/schema.ts';
import { ToolCalls } from '../../src/agents/tool-calls/service.ts';
import { GitLayer } from '../../src/git/layers.ts';
import { EngineStopped } from '../../src/runtime/engine/schema.ts';
import { EngineCore } from '../../src/runtime/engine/service.ts';
import { ScheduleToolRefused } from '../../src/schedules/tools/schema.ts';
import { ScheduleTools } from '../../src/schedules/tools/service.ts';
import { ShellLayer } from '../../src/shell/layers.ts';
import { Engine } from '../helpers/engine.ts';
import { openEventLog, type TestEventLog } from '../helpers/event-log.ts';
import { createGitRepo, createTestConfig, git, until } from '../helpers/index.ts';
import { createTestMachine } from '../helpers/machine.ts';
import { createTestProviders } from '../helpers/providers.ts';
import { createLiveRuns } from './live-runs.ts';

const SPEC: PlanDocument = {
  goal: 'Ship it.',
  phases: [{ title: 'Fix it', detail: 'Clamp the width.' }],
  behaviour: ['It works.'],
  approach: 'Carefully.',
  files: [],
  outOfScope: [],
  verification: [{ label: 'Overflow test', command: 'bun test test/overflow.test.ts', phases: [1] }],
  questions: [],
};

const logs: TestEventLog[] = [];

afterEach(() => {
  for (const log of logs.splice(0)) log.close();
});

async function startBuilding() {
  const config = createTestConfig();
  const log = openEventLog(config.databasePath);
  logs.push(log);
  const engine = new Engine(log);
  const { path } = await createGitRepo({ remote: false });
  await engine.dispatch({
    type: 'repo.register',
    repo: { name: 'app', path, defaultBranch: 'main', remote: null, checkCommands: ['true'] },
    projectName: null,
  });
  const repoId = Object.keys(engine.state.repos)[0] ?? '';
  await engine.dispatch({ type: 'task.create', request: 'Fix the tab scroll', repoId });
  const taskId = Object.keys(engine.state.tasks)[0] ?? '';
  await engine.dispatch({
    type: 'task.triage',
    taskId,
    title: 'Fix the tab scroll',
    repoId,
    size: 'small',
    branch: 'fix/tab-scroll',
    waitsOn: [],
  });
  await engine.dispatch({ type: 'config.record', taskId, problems: [] });
  await engine.dispatch({ type: 'worktree.ready', taskId, path, branch: 'fix/tab-scroll' });
  const planning = Object.values(engine.state.runs)[0] as Run;
  await engine.dispatch({ type: 'agent.propose_plan', runId: planning.id, document: SPEC });
  const run = Object.values(engine.state.runs).find((candidate) => candidate.endedAt === null) as Run;
  const head = (await git(path, 'rev-parse', 'HEAD')).trim();
  return { config, engine, run, head };
}

interface Setup {
  config: ReturnType<typeof createTestConfig>;
  engine: Engine;
}

function createToolCalls({ config, engine }: Setup, extra: Layer.Layer<never> = Layer.empty) {
  const machine = createTestMachine(engine, config);
  const dependencies = Layer.mergeAll(
    createLiveRuns().layer,
    Layer.succeedContext(machine.context),
    Layer.succeed(Providers, createTestProviders([])),
    Layer.succeed(EngineCore, engine.core),
    Layer.succeed(DelegationMinute, Duration.millis(5)),
    GitLayer.pipe(Layer.provide(ShellLayer)),
    extra
  );
  return (name: string, call: Omit<ToolCall, 'signal'>) =>
    Effect.runPromise(
      ToolCalls.use((tools) => tools.handle(name, { ...call, signal: new AbortController().signal })).pipe(
        Effect.provide(ToolCallsLayer.pipe(Layer.provide(dependencies)))
      )
    );
}

function children(state: ShinsaState) {
  return Object.values(state.runs).filter(isDelegatedRun);
}

function parse(text: string) {
  return JSON.parse(text) as Record<string, unknown>;
}

describe('the tool calls of an agent', () => {
  test('a delegation in a worktree of its own starts from the commit the task’s checkout is on', async () => {
    const setup = await startBuilding();
    const handle = createToolCalls(setup);
    const reply = parse(
      await handle('delegate_task', {
        runId: setup.run.id,
        attemptId: '',
        input: { brief: 'Try it apart.', isolation: 'worktree' },
        requestId: 3,
      })
    );
    expect(reply).toMatchObject({ isolation: 'worktree', status: 'running' });
    expect(children(setup.engine.state)[0]?.delegation.baseCommit).toBe(setup.head);
  });

  test('a delegation it waits for gives up after its timeout and asks to be woken by the result', async () => {
    const setup = await startBuilding();
    const handle = createToolCalls(setup);
    const reply = parse(
      await handle('delegate_task', {
        runId: setup.run.id,
        attemptId: '',
        input: { brief: 'Check it.', mode: 'wait', timeout_minutes: 1 },
      })
    );
    expect(reply).toMatchObject({ wait_timed_out: true, status: 'running' });
    expect(children(setup.engine.state)[0]?.delegation.wake).toBe('always');
  });

  test('a delegation it waits for answers as soon as the agent ends', async () => {
    const setup = await startBuilding();
    const handle = createToolCalls(setup);
    const waiting = handle('delegate_task', {
      runId: setup.run.id,
      attemptId: '',
      input: { brief: 'Check it.', mode: 'wait', timeout_minutes: 60 },
    });
    await until('the delegation', () => children(setup.engine.state).length > 0);
    const child = children(setup.engine.state)[0] as Run;
    await setup.engine.dispatch({ type: 'run.end', runId: child.id, outcome: 'completed', summary: 'Done.' });
    expect(parse(await waiting)).toMatchObject({ wait_timed_out: false, result: 'Done.' });
  });

  test('reads a task, and refuses what this Shinsa cannot do', async () => {
    const setup = await startBuilding();
    const handle = createToolCalls(setup);
    const call = { runId: setup.run.id, attemptId: '' };
    expect(await handle('read_task', { ...call, input: { task_id: setup.run.taskId } })).toContain(
      'Fix the tab scroll'
    );
    await expect(handle('list_services', { ...call, input: {} })).rejects.toThrow(
      'list_services is not available while Shinsa runs without terminals.'
    );
    await expect(handle('tasks_list', { ...call, input: {} })).rejects.toThrow(
      'tasks_list is not available to this agent.'
    );
    await expect(handle('set_schedule', { ...call, input: {} })).rejects.toThrow(
      'Unknown tool set_schedule.'
    );
  });

  test('a schedule tool runs through the schedule tools, its refusals as the tool’s error', async () => {
    const setup = await startBuilding();
    const seen: string[] = [];
    const schedules = Layer.succeed(
      ScheduleTools,
      ScheduleTools.of({
        findHookUrl: () => Effect.succeed(''),
        assertSigningSecret: () => Effect.void,
        writeScheduleSecret: () => Effect.succeed(null),
        handle: (name, _input, run) => {
          if (name === 'list_schedules') return Effect.succeed('No schedules.');
          if (name !== 'set_schedule') return null;
          return run
            .dispatch({ type: 'agent.note', runId: run.runId, attemptId: run.attemptId, note: 'Scheduled.' })
            .pipe(
              Effect.tap(() => Effect.sync(() => seen.push(run.runId))),
              Effect.andThen(new ScheduleToolRefused({ message: 'The schedule needs a time.' }))
            );
        },
      })
    );
    const handle = createToolCalls(setup, schedules);
    const call = { runId: setup.run.id, attemptId: '', input: {} };
    expect(await handle('list_schedules', call)).toBe('No schedules.');
    await expect(handle('set_schedule', call)).rejects.toThrow('The schedule needs a time.');
    expect(seen).toEqual([setup.run.id]);
    await expect(handle('delete_schedule', call)).rejects.toThrow('Unknown tool delete_schedule.');
  });

  test('a schedule tool whose command fails tells the agent why', async () => {
    const setup = await startBuilding();
    const schedules = Layer.succeed(
      ScheduleTools,
      ScheduleTools.of({
        findHookUrl: () => Effect.succeed(''),
        assertSigningSecret: () => Effect.void,
        writeScheduleSecret: () => Effect.succeed(null),
        handle: (_name, _input, run) =>
          Effect.as(run.dispatch({ type: 'agent.note', runId: 'gone', attemptId: '', note: 'x' }), 'Sent.'),
      })
    );
    const stopped = Layer.succeed(EngineCore, {
      ...setup.engine.core,
      dispatch: () => Effect.fail(new EngineStopped({ message: 'Shinsa is stopping.' })),
    });
    const handle = createToolCalls(setup, Layer.merge(schedules, stopped));
    await expect(handle('set_schedule', { runId: setup.run.id, attemptId: '', input: {} })).rejects.toThrow(
      'Shinsa is stopping.'
    );
  });
});
