import {
  DomainError,
  type Gate,
  isAgentQuestion,
  isDelegatedRun,
  isSettingUpWorkspace,
  isTaskComplete,
  isTaskSettled,
  parseTaskHandle,
  type Run,
  resolveRepoWorkspace,
  type Task,
  type WorkspaceMode,
} from '../domain/index.ts';
import { listLiveChildRuns } from './delegations.ts';
import type { ShinsaState } from './project.ts';

export function listOpenGates(state: ShinsaState, taskId?: string) {
  return Object.values(state.gates).filter(
    (gate) => gate.status === 'open' && (taskId === undefined || gate.taskId === taskId)
  );
}

export function isHeldInBacklog(state: ShinsaState, gate: Gate) {
  return gate.type === 'plan' && Boolean(state.tasks[gate.taskId]?.backlog);
}

export function listLiveRuns(state: ShinsaState, taskId?: string) {
  return Object.values(state.runs).filter(
    (run) => run.endedAt === null && (taskId === undefined || run.taskId === taskId)
  );
}

export function listActiveRuns(state: ShinsaState, taskId?: string) {
  return listLiveRuns(state, taskId).filter((run) => !run.delegation);
}

export function resolveActiveRunTasks(state: ShinsaState) {
  const tasks = new Set<string>();
  for (const run of Object.values(state.runs)) {
    if (run.endedAt === null && !run.delegation) tasks.add(run.taskId);
  }
  return tasks;
}

export function resolveMovingTasks(state: ShinsaState) {
  const tasks = resolveActiveRunTasks(state);
  for (const gate of Object.values(state.gates)) {
    if (gate.status === 'open') tasks.add(gate.taskId);
  }
  return tasks;
}

export function listRunningRuns(state: ShinsaState, taskId?: string) {
  return listActiveRuns(state, taskId).filter((run) => run.status !== 'queued');
}

export function isWaitingOnAnswer(state: ShinsaState, run: Run) {
  if (isDelegatedRun(run) && run.delegation.question?.answer === null) return true;
  return listOpenGates(state, run.taskId).some((gate) => isAgentQuestion(gate) && gate.runId === run.id);
}

export function isRunWaiting(state: ShinsaState, run: Run) {
  if (run.status === 'waiting' || isWaitingOnAnswer(state, run)) return true;
  return listLiveChildRuns(state, run.id).some((child) => child.delegation.wake === 'settled_only');
}

function listDependencies(state: ShinsaState, task: Task) {
  return task.waitsOn.map((id) => state.tasks[id]).filter((dependency) => dependency !== undefined);
}

export function listOpenBlockers(state: ShinsaState, task: Task) {
  return listDependencies(state, task).filter((dependency) => !isTaskSettled(dependency));
}

export function listPendingDependencies(state: ShinsaState, task: Task) {
  return listDependencies(state, task).filter((dependency) => !isTaskComplete(dependency));
}

export function resolveTaskWorkspace(state: ShinsaState, task: Task): WorkspaceMode {
  if (task.worktreePath !== null || isSettingUpWorkspace(task)) {
    return task.workspace ?? resolveRepoWorkspace(null);
  }
  return resolveRepoWorkspace(task.repoId === null ? null : state.repos[task.repoId]);
}

function holdsCheckout(task: Task) {
  return task.workspace === 'main_checkout' && (task.worktreePath !== null || isSettingUpWorkspace(task));
}

export function selectCheckoutHolder(state: ShinsaState, task: Task) {
  if (task.repoId === null) return null;
  return (
    Object.values(state.tasks).find(
      (other) => other.id !== task.id && other.repoId === task.repoId && holdsCheckout(other)
    ) ?? null
  );
}

export function isWaitingForCheckout(state: ShinsaState, task: Task) {
  if (holdsCheckout(task) || resolveTaskWorkspace(state, task) !== 'main_checkout') return false;
  return selectCheckoutHolder(state, task) !== null;
}

export function listDependents(state: ShinsaState, taskId: string) {
  return Object.values(state.tasks).filter((task) => task.waitsOn.includes(taskId) && !isTaskSettled(task));
}

export function isDependencyOf(state: ShinsaState, taskId: string, candidateId: string) {
  const seen = new Set<string>();
  const pending = [candidateId];
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    if (id === taskId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    pending.push(...(state.tasks[id]?.waitsOn ?? []));
  }
  return false;
}

export function resolveTaskProject(state: Pick<ShinsaState, 'repos'>, task: Task) {
  if (task.projectId) return task.projectId;
  if (!task.repoId) return null;
  return state.repos[task.repoId]?.projectId ?? null;
}

export function selectTaskByHandle(state: ShinsaState, text: string) {
  const handle = parseTaskHandle(text);
  if (!handle) return null;
  return Object.values(state.tasks).find((task) => task.handle === handle) ?? null;
}

export function selectTaskByReference(state: ShinsaState, reference: string) {
  return state.tasks[reference] ?? selectTaskByHandle(state, reference);
}

export function listProjectRepos(state: ShinsaState, projectId: string) {
  return Object.values(state.repos).filter((repo) => repo.projectId === projectId);
}

export function isTriaged(task: Task) {
  return task.size !== null;
}

export function findRun(state: ShinsaState, runId: string) {
  const run = state.runs[runId];
  if (!run) throw new DomainError('run_not_found', `No run ${runId}`);
  return run;
}

export function findTask(state: ShinsaState, taskId: string) {
  const task = state.tasks[taskId];
  if (!task) throw new DomainError('task_not_found', `No task ${taskId}`);
  return task;
}
