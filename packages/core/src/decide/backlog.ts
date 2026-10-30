import type { CommandOf } from '../commands/index.ts';
import {
  DomainError,
  isTaskSettled,
  needsWorktree,
  resolveInquiryStep,
  resolveTaskPipeline,
  type Task,
  type TaskStage,
} from '../domain/index.ts';
import { resolveBacklogStart } from '../prompts/index.ts';
import type { Decider } from './decider.ts';
import { startAfterPlan } from './shapes.ts';
import { requestWorkspace } from './workspaces.ts';

const BEFORE_BUILD: ReadonlySet<TaskStage> = new Set<TaskStage>([
  'triage',
  'waiting_on_tasks',
  'planning',
  'awaiting_plan',
]);

export const BACKLOG_REASON = 'in the backlog';
export const PLAN_READY_REASON = 'plan ready for you';

export function canWaitInBacklog(task: Task) {
  const pipeline = resolveTaskPipeline(task);
  return pipeline.includes('plan') && resolveInquiryStep(pipeline) === null;
}

function assertBacklogFits(task: Task) {
  if (isTaskSettled(task)) throw new DomainError('task_settled', 'This task is finished.');
  if (!canWaitInBacklog(task)) {
    throw new DomainError(
      'backlog_inquiry',
      'Only work that builds or runs an operation waits in the backlog. A question, research or an investigation starts at once.'
    );
  }
  const started = task.plan?.approvedAt || task.phaseReports.length > 0 || !BEFORE_BUILD.has(task.stage);
  if (started) {
    throw new DomainError(
      'backlog_started',
      'This task has started building, so it cannot move to the backlog. Cancel it, or let it finish.'
    );
  }
}

function hasOpenPlanGate(decider: Decider, taskId: string) {
  return decider.hasOpenGate(taskId, (gate) => gate.type === 'plan');
}

export function addToBacklog(decider: Decider, taskId: string) {
  decider.emit({ type: 'task.backlog_changed', taskId, backlog: true, cause: 'you' });
}

export function moveToBacklog(decider: Decider, command: CommandOf<'task.move_to_backlog'>) {
  const task = decider.task(command.taskId);
  if (task.backlog) return;
  assertBacklogFits(task);
  addToBacklog(decider, task.id);
  if (hasOpenPlanGate(decider, task.id)) decider.stage(task.id, 'awaiting_plan', BACKLOG_REASON);
  decider.requestBriefing(task.id);
}

export function removeFromBacklog(decider: Decider, command: CommandOf<'task.remove_from_backlog'>) {
  const task = decider.task(command.taskId);
  if (!task.backlog) return;
  decider.emit({ type: 'task.backlog_changed', taskId: task.id, backlog: false, cause: 'you' });
  if (hasOpenPlanGate(decider, task.id)) decider.stage(task.id, 'awaiting_plan', PLAN_READY_REASON);
  decider.requestBriefing(task.id);
}

export function releaseInquiryFromBacklog(decider: Decider, taskId: string) {
  const task = decider.task(taskId);
  if (!task.backlog || canWaitInBacklog(task)) return;
  decider.emit({ type: 'task.backlog_changed', taskId, backlog: false, cause: 'inquiry' });
}

export function isStartingFromBacklog(task: Task) {
  return Boolean(task.backlog && task.plan?.approvedAt);
}

export function startFromBacklog(decider: Decider, taskId: string) {
  const task = decider.task(taskId);
  if (task.worktreePath !== null && needsWorktree(resolveTaskPipeline(task))) {
    requestWorkspace(decider, taskId);
    return;
  }
  buildFromBacklog(decider, taskId);
}

export function buildFromBacklog(decider: Decider, taskId: string) {
  const task = decider.task(taskId);
  const waited = decider.context.now - (task.plan?.proposedAt ?? decider.context.now);
  decider.emit({ type: 'task.backlog_changed', taskId, backlog: false, cause: 'started' });
  startAfterPlan(decider, taskId, resolveBacklogStart(waited));
}
