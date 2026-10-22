import { DomainError, isTaskComplete, isTaskSettled, type Task } from '../model/index.ts';
import type { ShinsaState } from './project.ts';

export function listOpenGates(state: ShinsaState, taskId?: string) {
  return Object.values(state.gates).filter(
    (gate) => gate.status === 'open' && (taskId === undefined || gate.taskId === taskId)
  );
}

export function listActiveRuns(state: ShinsaState, taskId?: string) {
  return Object.values(state.runs).filter(
    (run) => run.endedAt === null && (taskId === undefined || run.taskId === taskId)
  );
}

export function listRunningRuns(state: ShinsaState, taskId?: string) {
  return listActiveRuns(state, taskId).filter((run) => run.status !== 'queued');
}

function listDependencies(state: ShinsaState, task: Task) {
  return task.blockedBy.map((id) => state.tasks[id]).filter((dependency) => dependency !== undefined);
}

export function listOpenBlockers(state: ShinsaState, task: Task) {
  return listDependencies(state, task).filter((dependency) => !isTaskSettled(dependency));
}

export function listPendingDependencies(state: ShinsaState, task: Task) {
  return listDependencies(state, task).filter((dependency) => !isTaskComplete(dependency));
}

export function listDependents(state: ShinsaState, taskId: string) {
  return Object.values(state.tasks).filter((task) => task.blockedBy.includes(taskId) && !isTaskSettled(task));
}

export function isDependencyOf(state: ShinsaState, taskId: string, candidateId: string) {
  const seen = new Set<string>();
  const pending = [candidateId];
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    if (id === taskId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    pending.push(...(state.tasks[id]?.blockedBy ?? []));
  }
  return false;
}

export function resolveTaskArea(state: ShinsaState, task: Task) {
  if (!task.repoId) return null;
  return state.repos[task.repoId]?.areaId ?? null;
}

export function selectTask(state: ShinsaState, taskId: string) {
  return state.tasks[taskId] ?? null;
}

export function findTask(state: ShinsaState, taskId: string) {
  const task = state.tasks[taskId];
  if (!task) throw new DomainError('task_not_found', `No task ${taskId}`);
  return task;
}
