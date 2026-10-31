import { compareTasks, DomainError, isTaskComplete, type Task } from '../domain/index.ts';
import { isDependencyOf, listOpenGates, listPendingDependencies } from '../state/queries.ts';
import { type Decider, quoteTitles } from './decider.ts';
import { startWork } from './lifecycle.ts';
import { reviewMergeHold } from './pull-requests.ts';
import { holdForCheckout } from './workspaces.ts';

export function resolveDependencies(decider: Decider, task: Task | null, ids: string[]) {
  const kept: string[] = [];
  for (const id of new Set(ids)) {
    if (id === task?.id) continue;
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
    case 'merged':
    case 'done':
    case 'cancelled':
      return;
  }
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
      decider.stage(task.id, 'waiting_on_tasks', `waiting for ${quoteTitles(pending)} to finish`);
      continue;
    }
    if (holdForCheckout(decider, task.id)) continue;
    startWork(decider, task.id);
  }
}
