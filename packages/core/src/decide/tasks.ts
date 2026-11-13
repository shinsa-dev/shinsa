import { Option } from 'effect';
import type { CommandOf, TriageReasons } from '../commands/index.ts';
import {
  copyUnreachedTeammate,
  DomainError,
  hasStep,
  isTaskResting,
  isTaskSettled,
  listQueuedRounds,
  RUN_STAGES,
  resolveRepoMove,
  resolveShapeOf,
  resolveTaskPipeline,
  resolveTaskRounds,
  SHAPE_PIPELINES,
  type SourceReport,
  type Task,
  type TaskAuto,
  type TaskCreator,
  type TaskShape,
  type TriageDecisions,
} from '../domain/index.ts';
import { resolveFocusProject } from '../queue/rank.ts';
import { resolveNextHandle } from '../state/project.ts';
import { findProject, findRepo } from '../state/queries.ts';
import {
  isBundleMember,
  isDependencyOf,
  isTriaged,
  isWaitingForCheckout,
  listPendingDependencies,
  resolveTaskWorkspace,
  selectStackRefusal,
} from '../state/queries.ts';
import {
  addToBacklog,
  buildApprovedPlan,
  isStartingApprovedPlan,
  releaseInquiryFromBacklog,
} from './backlog.ts';
import { type Decider, describeWaiting } from './decider.ts';
import { changeDependencies, changeStack, resolveDependencies, resolveStackParents } from './dependencies.ts';
import { closeTeammateDuplicate, closeTriageDuplicate, selectTriageDuplicate } from './duplicates.ts';
import { resolveCreatedMembership } from './initiatives.ts';
import { settleTask, startWork } from './lifecycle.ts';
import { assertNoMergeStepsLeft } from './merge-steps.ts';
import { finishMove } from './moves.ts';
import { retryTask } from './retry.ts';
import { isShapeLocked, resolveNextStep, startStep } from './shapes.ts';
import { assertNoWatchdogsLeft, stopAllWatchdogs } from './watchdogs.ts';

function assertRepo(decider: Decider, repoId: string | null) {
  if (repoId !== null) findRepo(decider.state, repoId);
}

function resolveCreatedProject(decider: Decider, command: CommandOf<'task.create'>) {
  if (command.projectId !== undefined) {
    if (command.projectId !== null) findProject(decider.state, command.projectId);
    return { projectId: command.projectId, auto: false };
  }
  const repoProject = command.repoId ? decider.state.repos[command.repoId]?.projectId : null;
  if (repoProject) return { projectId: repoProject, auto: false };
  const focus = resolveFocusProject(decider.state, decider.context.now);
  return focus && decider.state.projects[focus]
    ? { projectId: focus, auto: true }
    : { projectId: null, auto: false };
}

interface TaskLineage {
  parentTaskId?: string;
  createdBy?: TaskCreator;
  scheduleId?: string;
  sourceReport?: SourceReport;
  shape?: TaskShape;
}

function resolveCreatedOwner(decider: Decider, lineage: TaskLineage) {
  const { actor, byTask } = decider.context;
  const source = lineage.parentTaskId ?? byTask;
  const inherited = source ? decider.state.tasks[source]?.owner : null;
  return inherited ?? actor ?? null;
}

export function createTask(decider: Decider, command: CommandOf<'task.create'>, lineage: TaskLineage = {}) {
  const request = command.request.trim();
  if (request.length === 0)
    throw new DomainError({ code: 'intent_required', message: 'Describe what you want done.' });
  assertRepo(decider, command.repoId);
  const stacksOn = resolveStackParents(decider, null, command.stacksOn ?? [], command.repoId);
  const dependencies = resolveDependencies(decider, null, command.waitsOn ?? []);
  const created = resolveCreatedProject(decider, command);
  const projectId = created.projectId;
  if (command.forkOf !== undefined) decider.task(command.forkOf);
  if (command.forkOf !== undefined && command.teammateFork !== undefined)
    throw new DomainError({ code: 'fork_twice', message: 'Fork one task at a time.' });
  const owner = resolveCreatedOwner(decider, lineage);
  const membership = resolveCreatedMembership(decider, command, lineage);
  const taskId = decider.context.newId();
  const auto: TaskAuto = {
    shape: command.mode === undefined && lineage.shape === undefined,
    start: command.waitsOn === undefined && stacksOn.length === 0,
    priority: command.priority === undefined,
    project: created.auto,
  };
  decider.emit({
    type: 'task.created',
    taskId,
    request,
    repoId: command.repoId,
    ...(projectId ? { projectId } : {}),
    ...(projectId && !auto.project ? { handle: resolveNextHandle(decider.state, projectId) } : {}),
    priority: command.priority ?? 'normal',
    planFirst: command.planFirst ?? false,
    origin: command.origin ?? null,
    ...(command.mode === 'ask' ? { mode: 'ask' as const } : {}),
    auto,
    ...(command.account ? { account: command.account } : {}),
    ...(command.forkOf ? { forkOf: command.forkOf } : {}),
    ...(command.teammateFork ? { teammateFork: command.teammateFork } : {}),
    ...(owner ? { owner } : {}),
    ...membership,
    ...lineage,
  });
  const by = lineage.createdBy ? 'shinsa' : 'you';
  if (stacksOn.length > 0) changeStack(decider, taskId, stacksOn, by);
  const waitsOn = dependencies.filter(
    (id) => !stacksOn.includes(id) && !isBundleMember(decider.state, decider.task(taskId), id)
  );
  if (waitsOn.length > 0) decider.emit({ type: 'task.waits_on_changed', taskId, waitsOn, by });
  if (command.backlog) addToBacklog(decider, taskId);
  decider.run({ kind: 'task.triage', taskId });
  return taskId;
}

function inferDependencies(decider: Decider, taskId: string, ids: string[], stacked: string[]) {
  const bundled = [decider.task(taskId), ...stacked.map((id) => decider.task(id))];
  return [...new Set(ids)].filter((id) => {
    const dependency = decider.state.tasks[id];
    return (
      dependency !== undefined &&
      id !== taskId &&
      !bundled.some((member) => isBundleMember(decider.state, member, id)) &&
      !isTaskSettled(dependency) &&
      !isDependencyOf(decider.state, taskId, id)
    );
  });
}

function resolveTriageStack(
  decider: Decider,
  task: Task,
  command: CommandOf<'task.triage'>,
  shape: TaskShape | undefined
) {
  const { repoId } = command;
  if (!task.auto.start || !command.stacksOn?.length || task.stacksOn?.length || repoId === null) return [];
  const pipeline = shape ? [...SHAPE_PIPELINES[shape]] : task.pipeline;
  if (!hasStep({ pipeline, mode: task.mode }, 'pull_request')) return [];
  return [...new Set(command.stacksOn)].filter((id) => {
    const parent = decider.state.tasks[id];
    return (
      parent !== undefined &&
      parent.repoId === repoId &&
      Option.isNone(selectStackRefusal(decider.state, task, parent, repoId))
    );
  });
}

interface TriageChoices {
  inferred: string[];
  stacked: string[];
}

function resolveDecisions(
  task: Task,
  command: CommandOf<'task.triage'>,
  { inferred, stacked }: TriageChoices,
  reasons: TriageReasons
): TriageDecisions {
  const shape = command.shape ?? resolveShapeOf(resolveTaskPipeline(task));
  return {
    shape: task.auto.shape ? { value: shape, why: reasons.shape ?? '' } : null,
    start: task.auto.start ? { value: inferred, why: reasons.start ?? '' } : null,
    priority: task.auto.priority
      ? { value: command.priority ?? task.priority, why: reasons.priority ?? '' }
      : null,
    ...(stacked.length > 0 ? { stack: { value: stacked, why: reasons.stack ?? '' } } : {}),
    ...(command.unreached ? { duplicate: { unreached: command.unreached.map(copyUnreachedTeammate) } } : {}),
  };
}

export function triageTask(decider: Decider, command: CommandOf<'task.triage'>) {
  const task = decider.task(command.taskId);
  if (isTaskSettled(task) || isTriaged(task)) return;
  assertRepo(decider, command.repoId);
  const shape = task.auto.shape && !isShapeLocked(task) ? command.shape : undefined;
  const stacked = resolveTriageStack(decider, task, command, shape);
  const inferred = task.auto.start ? inferDependencies(decider, task.id, command.waitsOn, stacked) : [];
  const decisions = resolveDecisions(task, command, { inferred, stacked }, command.reasons ?? {});
  const projectId =
    Option.getOrNull(resolveRepoMove(task, decider.repoOf(command))) ?? task.projectId ?? null;
  decider.emit({
    type: 'task.triaged',
    taskId: task.id,
    title: command.title,
    repoId: command.repoId,
    ...(projectId === task.projectId ? {} : { projectId }),
    ...(task.handle ? {} : { handle: resolveNextHandle(decider.state, projectId) }),
    size: command.size,
    branch: command.branch,
    ...(shape ? { pipeline: [...SHAPE_PIPELINES[shape]] } : {}),
    decisions,
  });
  if (task.auto.priority && command.priority && command.priority !== task.priority) {
    decider.emit({ type: 'task.prioritized', taskId: task.id, priority: command.priority });
  }
  if (stacked.length > 0) changeStack(decider, task.id, stacked, 'shinsa');
  if (inferred.length > 0) {
    decider.emit({ type: 'task.waits_on_changed', taskId: task.id, waitsOn: inferred, by: 'shinsa' });
  }
  const why = command.reasons?.duplicate ?? null;
  const original = selectTriageDuplicate(decider, task, command.repoId, command.duplicateOf);
  if (Option.isSome(original)) {
    closeTriageDuplicate(decider, decider.task(task.id), original.value, why);
    return;
  }
  if (command.duplicateOfTeammate) {
    closeTeammateDuplicate(decider, decider.task(task.id), command.duplicateOfTeammate, why);
    return;
  }
  releaseInquiryFromBacklog(decider, task.id);
  startWork(decider, task.id);
}

export function prioritizeTask(decider: Decider, command: CommandOf<'task.prioritize'>) {
  if (decider.task(command.taskId).priority === command.priority) return;
  decider.emit({ type: 'task.prioritized', taskId: command.taskId, priority: command.priority, by: 'you' });
  decider.requestBriefing(command.taskId);
}

export function waitOnTasks(decider: Decider, command: CommandOf<'task.wait_on'>) {
  const task = decider.task(command.taskId);
  if (isTaskSettled(task)) throw new DomainError({ code: 'task_settled', message: 'This task is finished.' });
  changeDependencies(decider, task.id, resolveDependencies(decider, task, command.waitsOn), 'you');
}

export function cancelTask(decider: Decider, command: CommandOf<'task.cancel'>) {
  settleTask(decider, command.taskId, 'cancelled', 'cancelled by you', 'you');
  stopAllWatchdogs(decider, command.taskId);
}

function assertNothingOpen(task: Task) {
  if (listQueuedRounds(task).length > 0) {
    throw new DomainError({ code: 'task_open', message: 'Rounds are still waiting to start.' });
  }
  if (task.pullRequest?.state === 'open') {
    throw new DomainError({
      code: 'task_open',
      message: `Pull request #${task.pullRequest.number} is still open.`,
    });
  }
}

function assertNoShippedRoundOpen(task: Task) {
  const shipped = resolveTaskRounds(task).find(
    (round) => round.status === 'shipped' && round.pullRequest?.state === 'open'
  );
  if (!shipped?.pullRequest) return;
  throw new DomainError({
    code: 'task_open',
    message: `Pull request #${shipped.pullRequest.number} is still open.`,
  });
}

export function completeTask(decider: Decider, command: CommandOf<'task.complete'>) {
  const task = decider.task(command.taskId);
  if (decider.context.onBehalf) {
    assertNothingOpen(task);
    assertNoWatchdogsLeft(task);
  }
  assertNoShippedRoundOpen(task);
  assertNoMergeStepsLeft(task);
  stopAllWatchdogs(decider, task.id);
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
      throw new DomainError({ code: 'no_agent_step', message: 'No agent works on this step.' });
    }
    decider.bindNextRun(task.id, command.account);
  }
  decider.resetRecoveries(command.taskId);
  retryTask(decider, command.taskId, null);
}

export function readyWorktree(decider: Decider, command: CommandOf<'worktree.ready'>) {
  const current = decider.task(command.taskId);
  if (current.repoId === null || current.movingTo || isWaitingForCheckout(decider.state, current)) return;
  const workspace = resolveTaskWorkspace(decider.state, current);
  const unchanged =
    current.worktreePath === command.path &&
    current.branch === command.branch &&
    current.workspace === workspace &&
    (command.returnBranch === undefined || current.returnBranch === command.returnBranch);
  if (!unchanged) {
    decider.emit({
      type: 'worktree.created',
      taskId: command.taskId,
      path: command.path,
      branch: command.branch,
      workspace,
      ...(command.returnBranch === undefined ? {} : { returnBranch: command.returnBranch }),
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
    decider.stage(task.id, 'waiting_on_tasks', describeWaiting(task, pending));
    return;
  }
  if (isStartingApprovedPlan(task)) {
    buildApprovedPlan(decider, task.id);
    return;
  }
  startStep(decider, task.id, resolveNextStep(task));
}

export function removeWorktree(decider: Decider, command: CommandOf<'worktree.gone'>) {
  if (decider.task(command.taskId).worktreePath === null) return;
  decider.emit({ type: 'worktree.removed', taskId: command.taskId });
  finishMove(decider, command.taskId);
}

export function failEffect(decider: Decider, command: CommandOf<'effect.fail'>) {
  const repeated = decider.hasOpenGate(
    command.taskId,
    (gate) => gate.type === 'failure' && gate.title === command.title && gate.body === command.detail
  );
  if (repeated) return;
  decider.fail(command.taskId, command.title, command.detail);
}
