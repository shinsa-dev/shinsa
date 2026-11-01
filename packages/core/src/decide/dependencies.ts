import type { CommandOf } from '../commands/index.ts';
import {
  compareTasks,
  DomainError,
  hasStep,
  isTaskComplete,
  isTaskSettled,
  resolveCurrentRound,
  type Task,
  type TaskStage,
} from '../domain/index.ts';
import {
  isDependencyOf,
  isStackPending,
  isTriaged,
  listOpenGates,
  listPendingDependencies,
  selectStackedOnThis,
  selectStackParent,
} from '../state/queries.ts';
import { type Decider, describeWaiting, quoteTitles } from './decider.ts';
import { startWork } from './lifecycle.ts';
import { reviewMergeHold } from './pull-requests.ts';
import { holdForCheckout } from './workspaces.ts';

export function resolveDependencies(decider: Decider, task: Task | null, ids: string[]) {
  const kept: string[] = [];
  for (const id of new Set(ids)) {
    if (id === task?.id || id === task?.stacksOn) continue;
    const dependency = decider.task(id);
    if (task?.waitsOn.includes(id)) {
      kept.push(id);
      continue;
    }
    if (dependency.stage === 'cancelled') {
      throw new DomainError('dependency_cancelled', 'That task was cancelled.');
    }
    if (isTaskComplete(dependency)) continue;
    if (task && isDependencyOf(decider.state, task.id, id)) {
      throw new DomainError('dependency_cycle', 'That task already waits on this one.');
    }
    kept.push(id);
  }
  return kept;
}

function isSameList(a: string[], b: string[]) {
  return a.length === b.length && a.every((id) => b.includes(id));
}

export function changeDependencies(
  decider: Decider,
  taskId: string,
  waitsOn: string[],
  by: 'you' | 'shinsa'
) {
  const task = decider.task(taskId);
  if (isSameList(waitsOn, task.waitsOn)) return;
  decider.emit({ type: 'task.waits_on_changed', taskId, waitsOn, by });
  switch (task.stage) {
    case 'waiting_on_tasks':
      decider.withdrawGates(taskId, (gate) => gate.type === 'failure');
      startWork(decider, taskId);
      return;
    case 'planning':
      if (listPendingDependencies(decider.state, decider.task(taskId)).length > 0) startWork(decider, taskId);
      return;
    case 'shipping':
    case 'awaiting_merge':
      reviewMergeHold(decider, taskId);
      return;
    case 'triage':
    case 'awaiting_plan':
    case 'building':
    case 'checking':
    case 'reviewing':
    case 'fixing':
    case 'awaiting_review':
    case 'answering':
    case 'investigating':
    case 'researching':
    case 'operating':
    case 'awaiting_proposal':
    case 'awaiting_operation':
    case 'answered':
    case 'merged':
    case 'done':
    case 'cancelled':
      return;
  }
}

const STACKABLE_STAGES: ReadonlySet<TaskStage> = new Set<TaskStage>([
  'triage',
  'waiting_on_tasks',
  'planning',
  'awaiting_plan',
]);

export function resolveStackParent(
  decider: Decider,
  task: Task | null,
  id: string,
  repoId = task?.repoId ?? null
) {
  if (id === task?.id) throw new DomainError('stack_self', 'A task cannot stack on itself.');
  const parent = decider.task(id);
  if (parent.stage === 'cancelled') throw new DomainError('dependency_cancelled', 'That task was cancelled.');
  if (isTaskSettled(parent)) {
    throw new DomainError('stack_parent_settled', 'That task is finished, so there is nothing to stack on.');
  }
  if (!hasStep(parent, 'pull_request')) {
    throw new DomainError('stack_no_pull_request', 'That task opens no pull request to stack on.');
  }
  if (repoId && parent.repoId && repoId !== parent.repoId) {
    throw new DomainError('stack_repository', 'The tasks of a bundle work in one repository.');
  }
  const taken = selectStackedOnThis(decider.state, id);
  if (taken && taken.id !== task?.id) {
    throw new DomainError('stack_taken', `“${taken.title}” is already stacked on that task.`);
  }
  if (task && isDependencyOf(decider.state, task.id, id)) {
    throw new DomainError('dependency_cycle', 'That task already waits on this one.');
  }
  return id;
}

function resolveStackBase(decider: Decider, task: Task) {
  const parent = selectStackParent(decider.state, task);
  if (!parent || isTaskComplete(parent) || parent.repoId !== task.repoId) return null;
  return resolveCurrentRound(parent).branch ?? parent.branch;
}

export function syncStackBase(decider: Decider, taskId: string) {
  const task = decider.task(taskId);
  const base = resolveStackBase(decider, task);
  if (base === (task.stackBase ?? null)) return;
  decider.emit({ type: 'task.stack_based', taskId, base });
}

function restartForStack(decider: Decider, taskId: string) {
  const task = decider.task(taskId);
  switch (task.stage) {
    case 'waiting_on_tasks':
      decider.withdrawGates(taskId, (gate) => gate.type === 'failure');
      startWork(decider, taskId);
      return;
    case 'planning':
    case 'awaiting_plan':
      decider.withdrawGates(taskId, (gate) => gate.type === 'plan');
      decider.cancelRuns(taskId);
      startWork(decider, taskId);
      return;
    default: {
      const parent = selectStackParent(decider.state, task);
      if (!parent || !isStackPending(decider.state, parent)) syncStackBase(decider, taskId);
      else if (isTriaged(task)) startWork(decider, taskId);
    }
  }
}

export function changeStack(decider: Decider, taskId: string, stacksOn: string | null, by: 'you' | 'shinsa') {
  const task = decider.task(taskId);
  decider.emit({ type: 'task.stack_changed', taskId, stacksOn, by });
  if (stacksOn && task.waitsOn.includes(stacksOn)) {
    const waitsOn = task.waitsOn.filter((id) => id !== stacksOn);
    decider.emit({ type: 'task.waits_on_changed', taskId, waitsOn, by });
  }
}

export function stackOnTask(decider: Decider, command: CommandOf<'task.stack_on'>) {
  const task = decider.task(command.taskId);
  if (isTaskSettled(task)) throw new DomainError('task_settled', 'This task is finished.');
  const stacksOn = command.stacksOn === null ? null : resolveStackParent(decider, task, command.stacksOn);
  if ((task.stacksOn ?? null) === stacksOn) return;
  if (!STACKABLE_STAGES.has(task.stage)) {
    throw new DomainError(
      'stack_started',
      'This task has started building, so its bundle can no longer change.'
    );
  }
  changeStack(decider, task.id, stacksOn, 'you');
  restartForStack(decider, task.id);
}

function pauseForCancelled(decider: Decider, task: Task, cancelled: Task[], remaining: Task[]) {
  const one = cancelled.length === 1;
  const waited = `This task was waiting for ${one ? 'it' : 'them'} to finish.`;
  const choices =
    remaining.length > 0
      ? `Retry to keep waiting on ${quoteTitles(remaining)} only, wait for another task instead, or cancel this one.`
      : 'Retry to start without that work, wait for another task instead, or cancel this one.';
  decider.openGate(
    task.id,
    'failure',
    `${quoteTitles(cancelled)} ${one ? 'was' : 'were'} cancelled`,
    `${waited} ${choices}`
  );
}

export function releaseWaiting(decider: Decider) {
  const queued = Object.values(decider.state.tasks)
    .filter((task) => task.stage === 'waiting_on_tasks')
    .sort(compareTasks);
  for (const task of queued) {
    if (listOpenGates(decider.state, task.id).length > 0) continue;
    const pending = listPendingDependencies(decider.state, task);
    const cancelled = pending.filter((dependency) => dependency.stage === 'cancelled');
    if (cancelled.length > 0) {
      pauseForCancelled(
        decider,
        task,
        cancelled,
        pending.filter((dependency) => dependency.stage !== 'cancelled')
      );
      continue;
    }
    if (pending.length > 0) {
      decider.stage(task.id, 'waiting_on_tasks', describeWaiting(decider.state, task, pending));
      continue;
    }
    if (holdForCheckout(decider, task.id)) continue;
    startWork(decider, task.id);
  }
}
