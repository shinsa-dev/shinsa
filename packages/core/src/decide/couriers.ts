import type { CommandOf } from '../commands/index.ts';
import { DELEGATION_LIMITS, DomainError, type Run, type Task, type TaskCreator } from '../domain/index.ts';
import type { Decider } from './decider.ts';
import { changeDependencies } from './dependencies.ts';
import { findCurrentRun } from './runs.ts';
import { createTask } from './tasks.ts';

function selectCreated(decider: Decider, task: Task, requestKey: string) {
  return (
    Object.values(decider.state.tasks).find(
      (candidate) => candidate.createdBy?.taskId === task.id && candidate.createdBy.requestKey === requestKey
    ) ?? null
  );
}

function assertCanWait(run: Run) {
  if (run.purpose === 'build' || run.purpose === 'fix') return;
  throw new DomainError(
    'cannot_wait',
    'Only a task that is building can wait on a task it creates. Create it with this_task_waits once you build, or now with after_this when it should merge after this task; otherwise create it without either and say how the two relate in your hand-over.'
  );
}

function assertOneOrder(command: CommandOf<'agent.create_task'>) {
  if (!command.thisWaits || !command.afterThis) return;
  throw new DomainError(
    'dependency_cycle',
    'Set this_task_waits or after_this, not both: two tasks cannot each wait for the other to merge.'
  );
}

interface SpawnOptions {
  parent: boolean;
  forkOf?: string;
  waitsOn?: string[];
}

function spawnTask(
  decider: Decider,
  source: Task,
  request: string,
  creator: TaskCreator,
  options: SpawnOptions
) {
  const { parent } = options;
  return createTask(
    decider,
    {
      type: 'task.create',
      request,
      repoId: source.repoId,
      priority: source.priority,
      origin: source.origin,
      ...(options.forkOf ? { forkOf: options.forkOf } : {}),
      ...(options.waitsOn ? { waitsOn: options.waitsOn } : {}),
    },
    { createdBy: creator, ...(parent ? { parentTaskId: source.id, shape: 'change' as const } : {}) }
  );
}

function waitOn(decider: Decider, task: Task, ids: string[]) {
  changeDependencies(decider, task.id, [...task.waitsOn, ...ids], 'shinsa');
}

export function createCourierTask(decider: Decider, command: CommandOf<'agent.create_task'>) {
  const { run, task } = findCurrentRun(decider, command.runId, 'create_task');
  if (selectCreated(decider, task, command.requestKey)) return;
  assertOneOrder(command);
  if (command.thisWaits) assertCanWait(run);
  const createdId = spawnTask(
    decider,
    command.repoId ? { ...task, repoId: command.repoId } : task,
    command.request,
    { kind: 'courier', taskId: task.id, runId: run.id, requestKey: command.requestKey },
    {
      parent: false,
      ...(command.forkOf ? { forkOf: command.forkOf } : {}),
      ...(command.afterThis ? { waitsOn: [task.id] } : {}),
    }
  );
  if (command.thisWaits) waitOn(decider, decider.task(task.id), [createdId]);
}

export function splitTask(decider: Decider, command: CommandOf<'agent.split_task'>) {
  const { run, task } = findCurrentRun(decider, command.runId, 'split_task');
  const version = task.plan?.version ?? 0;
  if (task.splits?.some((split) => split.planVersion === version)) return;
  if (command.requests.length === 0 || command.requests.length > DELEGATION_LIMITS.splitTasks) {
    throw new DomainError(
      'split_size',
      `Split the plan into 1 to ${DELEGATION_LIMITS.splitTasks} tasks; this asked for ${command.requests.length}.`
    );
  }
  const requestKey = `plan:${version}`;
  const taskIds = command.requests.map((request) =>
    spawnTask(
      decider,
      task,
      request,
      { kind: 'split', taskId: task.id, runId: run.id, requestKey },
      { parent: true }
    )
  );
  decider.emit({
    type: 'task.split',
    taskId: task.id,
    split: { planVersion: version, runId: run.id, taskIds, at: decider.context.now },
  });
  if (command.thisWaits) waitOn(decider, decider.task(task.id), taskIds);
}
