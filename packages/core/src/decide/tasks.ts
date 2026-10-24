import type { CommandOf, TriageReasons } from '../commands/index.ts';
import {
  DomainError,
  isTaskResting,
  isTaskSettled,
  listQueuedRounds,
  RUN_STAGES,
  resolveShapeOf,
  resolveTaskPipeline,
  resolveTaskRounds,
  SHAPE_PIPELINES,
  type Task,
  type TaskAuto,
  type TaskCreator,
  type TriageDecisions,
} from '../domain/index.ts';
import { resolveFocusProject } from '../queue/rank.ts';
import { resolveNextHandle } from '../state/project.ts';
import { isDependencyOf, isTriaged, listPendingDependencies } from '../state/queries.ts';
import { type Decider, quoteTitles } from './decider.ts';
import { changeDependencies, resolveDependencies } from './dependencies.ts';
import { settleTask, startWork } from './lifecycle.ts';
import { retryTask } from './retry.ts';
import { isShapeLocked, resolveNextStep, startStep } from './shapes.ts';

function assertRepo(decider: Decider, repoId: string | null) {
  if (repoId !== null && !decider.state.repos[repoId]) {
    throw new DomainError('repo_not_found', `No repository ${repoId}`);
  }
}

function resolveCreatedProject(decider: Decider, command: CommandOf<'task.create'>) {
  if (command.projectId !== undefined) {
    if (command.projectId !== null && !decider.state.projects[command.projectId]) {
      throw new DomainError('project_not_found', `No project ${command.projectId}`);
    }
    return command.projectId;
  }
  const repoProject = command.repoId ? decider.state.repos[command.repoId]?.projectId : null;
  if (repoProject) return repoProject;
  const focus = resolveFocusProject(decider.state, decider.context.now);
  return focus && decider.state.projects[focus] ? focus : null;
}

interface TaskLineage {
  parentTaskId?: string;
  createdBy?: TaskCreator;
  scheduleId?: string;
}

export function createTask(decider: Decider, command: CommandOf<'task.create'>, lineage: TaskLineage = {}) {
  const request = command.request.trim();
  if (request.length === 0) throw new DomainError('intent_required', 'Describe what you want done.');
  assertRepo(decider, command.repoId);
  const waitsOn = resolveDependencies(decider, null, command.waitsOn ?? []);
  const projectId = resolveCreatedProject(decider, command);
  const taskId = decider.context.newId();
  const auto: TaskAuto = {
    shape: command.mode === undefined,
    start: command.waitsOn === undefined,
    priority: command.priority === undefined,
  };
  decider.emit({
    type: 'task.created',
    taskId,
    request,
    repoId: command.repoId,
    ...(projectId ? { projectId, handle: resolveNextHandle(decider.state, projectId) } : {}),
    priority: command.priority ?? 'normal',
    planFirst: command.planFirst ?? false,
    origin: command.origin ?? null,
    ...(command.mode === 'ask' ? { mode: 'ask' as const } : {}),
    auto,
    ...(command.account ? { account: command.account } : {}),
    ...lineage,
  });
  if (waitsOn.length > 0) decider.emit({ type: 'task.waits_on_changed', taskId, waitsOn, by: 'you' });
  decider.run({ kind: 'task.triage', taskId });
  return taskId;
}

function inferDependencies(decider: Decider, taskId: string, ids: string[]) {
  return [...new Set(ids)].filter((id) => {
    const dependency = decider.state.tasks[id];
    return (
      dependency !== undefined &&
      id !== taskId &&
      !isTaskSettled(dependency) &&
      !isDependencyOf(decider.state, taskId, id)
    );
  });
}

function isAutoStart(task: Task) {
  return task.auto ? task.auto.start : task.waitsOn.length === 0;
}

function resolveDecisions(
  task: Task,
  command: CommandOf<'task.triage'>,
  inferred: string[],
  reasons: TriageReasons
): TriageDecisions | null {
  if (!task.auto) return null;
  const shape = command.shape ?? resolveShapeOf(resolveTaskPipeline(task));
  return {
    shape: task.auto.shape ? { value: shape, why: reasons.shape ?? '' } : null,
    start: task.auto.start ? { value: inferred, why: reasons.start ?? '' } : null,
    priority: task.auto.priority
      ? { value: command.priority ?? task.priority, why: reasons.priority ?? '' }
      : null,
  };
}

export function triageTask(decider: Decider, command: CommandOf<'task.triage'>) {
  const task = decider.task(command.taskId);
  if (isTaskSettled(task) || isTriaged(task)) return;
  assertRepo(decider, command.repoId);
  const inferred = isAutoStart(task) ? inferDependencies(decider, task.id, command.waitsOn) : [];
  const decisions = resolveDecisions(task, command, inferred, command.reasons ?? {});
  const shape = task.auto?.shape && !isShapeLocked(task) ? command.shape : undefined;
  const projectId = task.projectId ?? decider.state.repos[command.repoId]?.projectId ?? null;
  decider.emit({
    type: 'task.triaged',
    taskId: task.id,
    title: command.title,
    repoId: command.repoId,
    ...(task.projectId ? {} : { projectId }),
    ...(task.handle ? {} : { handle: resolveNextHandle(decider.state, projectId) }),
    size: command.size,
    branch: command.branch,
    ...(shape ? { pipeline: [...SHAPE_PIPELINES[shape]] } : {}),
    ...(decisions ? { decisions } : {}),
  });
  if (task.auto?.priority && command.priority && command.priority !== task.priority) {
    decider.emit({ type: 'task.prioritized', taskId: task.id, priority: command.priority });
  }
  if (inferred.length > 0) {
    decider.emit({ type: 'task.waits_on_changed', taskId: task.id, waitsOn: inferred, by: 'shinsa' });
  }
  startWork(decider, task.id);
}

export function prioritizeTask(decider: Decider, command: CommandOf<'task.prioritize'>) {
  if (decider.task(command.taskId).priority === command.priority) return;
  decider.emit({ type: 'task.prioritized', taskId: command.taskId, priority: command.priority, by: 'you' });
  decider.requestBriefing(command.taskId);
}

export function waitOnTasks(decider: Decider, command: CommandOf<'task.wait_on'>) {
  const task = decider.task(command.taskId);
  if (isTaskSettled(task)) throw new DomainError('task_settled', 'This task is finished.');
  changeDependencies(decider, task.id, resolveDependencies(decider, task, command.waitsOn), 'you');
}

export function cancelTask(decider: Decider, command: CommandOf<'task.cancel'>) {
  settleTask(decider, command.taskId, 'cancelled', 'cancelled by you', 'you');
}

function assertNothingOpen(task: Task) {
  if (listQueuedRounds(task).length > 0) {
    throw new DomainError(
      'task_open',
      'This task still has rounds waiting to start. Leave it open, or tell the human what is left.'
    );
  }
  if (task.pullRequest?.state === 'open') {
    throw new DomainError(
      'task_open',
      `Pull request #${task.pullRequest.number} of this task is still open. Leave the task open until it merges.`
    );
  }
}

function assertNoShippedRoundOpen(task: Task) {
  const shipped = resolveTaskRounds(task).find(
    (round) => round.status === 'shipped' && round.pullRequest?.state === 'open'
  );
  if (!shipped?.pullRequest) return;
  throw new DomainError(
    'task_open',
    `Pull request #${shipped.pullRequest.number} of round ${shipped.number} is still open. Merge it before the task is marked done, or cancel the task.`
  );
}

export function completeTask(decider: Decider, command: CommandOf<'task.complete'>) {
  const task = decider.task(command.taskId);
  if (decider.context.onBehalf) assertNothingOpen(task);
  assertNoShippedRoundOpen(task);
  if (isTaskResting(task)) {
    decider.stage(task.id, 'done', 'marked done by you', 'you');
    decider.requestBriefing(task.id);
    return;
  }
  settleTask(decider, command.taskId, 'done', 'marked done by you', 'you');
}

export function retryTaskCommand(decider: Decider, command: CommandOf<'task.retry'>) {
  if (command.account) {
    const task = decider.task(command.taskId);
    if (!RUN_STAGES.has(task.stage)) {
      throw new DomainError(
        'no_agent_step',
        'No agent works on this step, so there is nothing to run on another account.'
      );
    }
    decider.bindNextRun(task.id, command.account);
  }
  decider.resetRecoveries(command.taskId);
  retryTask(decider, command.taskId, null);
}

export function readyWorktree(decider: Decider, command: CommandOf<'worktree.ready'>) {
  const current = decider.task(command.taskId);
  const unchanged = current.worktreePath === command.path && current.branch === command.branch;
  if (!unchanged) {
    decider.emit({
      type: 'worktree.created',
      taskId: command.taskId,
      path: command.path,
      branch: command.branch,
    });
  }
  const task = decider.task(command.taskId);
  if (isTaskSettled(task)) {
    if (!unchanged) decider.run({ kind: 'worktree.remove', taskId: task.id });
    return;
  }
  if (task.stage !== 'triage' || decider.hasOpenGate(task.id, (gate) => gate.type === 'configuration')) {
    return;
  }
  const pending = listPendingDependencies(decider.state, task);
  if (pending.length > 0) {
    decider.stage(task.id, 'waiting_on_tasks', `waiting for ${quoteTitles(pending)} to finish`);
    return;
  }
  startStep(decider, task.id, resolveNextStep(task));
}

export function removeWorktree(decider: Decider, command: CommandOf<'worktree.gone'>) {
  if (decider.task(command.taskId).worktreePath === null) return;
  decider.emit({ type: 'worktree.removed', taskId: command.taskId });
}

export function failEffect(decider: Decider, command: CommandOf<'effect.fail'>) {
  const repeated = decider.hasOpenGate(
    command.taskId,
    (gate) => gate.type === 'failure' && gate.title === command.title && gate.body === command.detail
  );
  if (repeated) return;
  decider.fail(command.taskId, command.title, command.detail);
}
