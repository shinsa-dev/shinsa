import type { CommandOf } from '../commands/index.ts';
import {
  compareTasks,
  DomainError,
  isTaskComplete,
  isTaskSettled,
  resolveCurrentRound,
  type Task,
} from '../domain/index.ts';
import {
  canChangeStack,
  isBundleMember,
  isDependencyOf,
  isTriaged,
  listOpenGates,
  listPendingDependencies,
  listPendingStackParents,
  listStackParents,
  resolveBundleMembers,
  selectStackRefusal,
} from '../state/queries.ts';
import { type Decider, describeWaiting, quoteTitles } from './decider.ts';
import { startWork } from './lifecycle.ts';
import { reviewMergeHold } from './pull-requests.ts';
import { holdForCheckout } from './workspaces.ts';

export function resolveDependencies(decider: Decider, task: Task | null, ids: string[]) {
  const kept: string[] = [];
  for (const id of new Set(ids)) {
    if (id === task?.id || task?.stacksOn?.includes(id) || (task && isBundleMember(decider.state, task, id)))
      continue;
    const dependency = decider.task(id);
    if (task?.waitsOn.includes(id)) {
      kept.push(id);
      continue;
    }
    if (dependency.stage === 'cancelled') {
      throw new DomainError({ code: 'dependency_cancelled', message: 'That task was cancelled.' });
    }
    if (isTaskComplete(dependency)) continue;
    if (task && isDependencyOf(decider.state, task.id, id)) {
      throw new DomainError({ code: 'dependency_cycle', message: 'That task already waits on this one.' });
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
  // oxlint-disable-next-line typescript/switch-exhaustiveness-check -- a task that is watching has merged, so what it waits on changes nothing
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

export function resolveStackParents(
  decider: Decider,
  task: Task | null,
  ids: string[],
  repoId = task?.repoId ?? null
) {
  const parents = [...new Set(ids)].map((id) => decider.task(id));
  const shared = repoId ?? parents.find((parent) => parent.repoId)?.repoId ?? null;
  for (const parent of parents) {
    const refusal = selectStackRefusal(decider.state, task, parent, shared);
    if (refusal) throw refusal;
  }
  return parents.map((parent) => parent.id);
}

function resolveStackBases(decider: Decider, task: Task) {
  return listStackParents(decider.state, task)
    .filter((parent) => !isTaskComplete(parent) && parent.repoId === task.repoId)
    .map((parent) => resolveCurrentRound(parent).branch ?? parent.branch)
    .filter((branch) => branch !== null);
}

function isSameOrder(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((id, index) => b[index] === id);
}

export function syncStackBases(decider: Decider, taskId: string) {
  const task = decider.task(taskId);
  const bases = resolveStackBases(decider, task);
  if (isSameOrder(bases, task.stackBases ?? [])) return;
  decider.emit({ type: 'task.stack_based', taskId, bases });
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
      if (listPendingStackParents(decider.state, task).length === 0) syncStackBases(decider, taskId);
      else if (isTriaged(task) && listOpenGates(decider.state, taskId).length === 0)
        startWork(decider, taskId);
    }
  }
}

export function changeStack(decider: Decider, taskId: string, stacksOn: string[], by: 'you' | 'shinsa') {
  decider.emit({ type: 'task.stack_changed', taskId, stacksOn, by });
  const task = decider.task(taskId);
  const members = resolveBundleMembers(decider.state, task);
  const joined = members.some((member) => member.id === taskId) ? members : [];
  const bundle = new Set([...stacksOn, ...joined.map((member) => member.id)]);
  const waitsOn = task.waitsOn.filter((id) => !bundle.has(id));
  if (waitsOn.length < task.waitsOn.length)
    decider.emit({ type: 'task.waits_on_changed', taskId, waitsOn, by });
  for (const member of joined) {
    if (member.id === taskId) continue;
    const kept = member.waitsOn.filter((id) => !bundle.has(id));
    if (kept.length < member.waitsOn.length) changeDependencies(decider, member.id, kept, by);
  }
}

export function stackOnTasks(decider: Decider, command: CommandOf<'task.stack_on_tasks'>) {
  const task = decider.task(command.taskId);
  if (isTaskSettled(task)) throw new DomainError({ code: 'task_settled', message: 'This task is finished.' });
  const stacksOn = resolveStackParents(decider, task, command.stacksOn);
  if (isSameOrder(task.stacksOn ?? [], stacksOn)) return;
  if (!canChangeStack(task)) {
    throw new DomainError({
      code: 'stack_started',
      message: 'This task has started building, so its bundle can no longer change.',
    });
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
      decider.stage(task.id, 'waiting_on_tasks', describeWaiting(task, pending));
      continue;
    }
    if (holdForCheckout(decider, task.id)) continue;
    startWork(decider, task.id);
  }
}
