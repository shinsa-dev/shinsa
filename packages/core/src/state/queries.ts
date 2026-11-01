import {
  DomainError,
  type Gate,
  hasStep,
  isAgentQuestion,
  isDelegatedRun,
  isSettingUpWorkspace,
  isTaskComplete,
  isTaskSettled,
  parseTaskHandle,
  type Run,
  resolveRepoWorkspace,
  type Task,
  type TaskStage,
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

export function selectStackParent(state: Pick<ShinsaState, 'tasks'>, task: Task) {
  return task.stacksOn ? (state.tasks[task.stacksOn] ?? null) : null;
}

export function selectStackedOnThis(state: ShinsaState, taskId: string) {
  return (
    Object.values(state.tasks).find(
      (task) => task.stacksOn === taskId && !isTaskSettled(task) && hasStep(task, 'pull_request')
    ) ?? null
  );
}

const STACKABLE_STAGES: ReadonlySet<TaskStage> = new Set<TaskStage>([
  'triage',
  'waiting_on_tasks',
  'planning',
  'awaiting_plan',
]);

export function canChangeStack(task: Task) {
  return !isTaskSettled(task) && STACKABLE_STAGES.has(task.stage);
}

export function selectStackRefusal(
  state: ShinsaState,
  task: Task | null,
  parent: Task,
  repoId = task?.repoId ?? null
) {
  if (parent.id === task?.id) return new DomainError('stack_self', 'A task cannot stack on itself.');
  if (parent.stage === 'cancelled')
    return new DomainError('dependency_cancelled', 'That task was cancelled.');
  if (isTaskSettled(parent)) {
    return new DomainError('stack_parent_settled', 'That task is finished, so there is nothing to stack on.');
  }
  if (!hasStep(parent, 'pull_request')) {
    return new DomainError('stack_no_pull_request', 'That task opens no pull request to stack on.');
  }
  if (repoId && parent.repoId && repoId !== parent.repoId) {
    return new DomainError('stack_repository', 'The tasks of a bundle work in one repository.');
  }
  const taken = selectStackedOnThis(state, parent.id);
  if (taken && taken.id !== task?.id) {
    return new DomainError('stack_taken', `“${taken.title}” is already stacked on that task.`);
  }
  if (task && isDependencyOf(state, task.id, parent.id)) {
    return new DomainError('dependency_cycle', 'That task already waits on this one.');
  }
  return null;
}

export function isReadyToStackOn(state: ShinsaState, task: Task) {
  if (task.pullRequest?.state !== 'open') return false;
  if (task.bundleReady) return true;
  return listOpenGates(state, task.id).some((gate) => gate.type === 'merge');
}

function isInBundle(task: Task) {
  return !isTaskComplete(task) && task.stage !== 'cancelled';
}

export function listBundleBelow(state: Pick<ShinsaState, 'tasks'>, task: Task) {
  const below: Task[] = [];
  let parent = selectStackParent(state, task);
  while (parent && isInBundle(parent) && !below.includes(parent)) {
    below.push(parent);
    parent = selectStackParent(state, parent);
  }
  return below;
}

function selectStackedChild(state: Pick<ShinsaState, 'tasks'>, task: Task) {
  const children = Object.values(state.tasks).filter((child) => child.stacksOn === task.id);
  return children.find((child) => !isTaskSettled(child)) ?? children.find(isTaskComplete) ?? null;
}

export function resolveBundle(state: Pick<ShinsaState, 'tasks'>, task: Task) {
  const bundle: Task[] = [task];
  let parent = selectStackParent(state, task);
  while (parent && !bundle.includes(parent)) {
    bundle.unshift(parent);
    parent = selectStackParent(state, parent);
  }
  let child = selectStackedChild(state, task);
  while (child && !bundle.includes(child)) {
    bundle.push(child);
    child = selectStackedChild(state, child);
  }
  return bundle.length > 1 ? bundle : [];
}

export function isStackPending(state: ShinsaState, parent: Task) {
  return !isTaskComplete(parent) && !isReadyToStackOn(state, parent);
}

export function listPendingDependencies(state: ShinsaState, task: Task) {
  const pending = listDependencies(state, task).filter((dependency) => !isTaskComplete(dependency));
  const parent = selectStackParent(state, task);
  if (!parent || !isStackPending(state, parent) || pending.includes(parent)) return pending;
  return [...pending, parent];
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
    const task = state.tasks[id];
    pending.push(...(task?.waitsOn ?? []), ...(task?.stacksOn ? [task.stacksOn] : []));
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
