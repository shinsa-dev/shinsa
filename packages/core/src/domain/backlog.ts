import { Option } from 'effect';
import { resolveInquiryStep, resolveTaskPipeline } from './shapes.ts';
import { isTaskSettled } from './stages.ts';
import type { Task, TaskStage } from './types.ts';

const BEFORE_BUILD: ReadonlySet<TaskStage> = new Set<TaskStage>([
  'triage',
  'waiting_on_tasks',
  'planning',
  'awaiting_plan',
]);

export type BacklogRefusal = 'task_settled' | 'backlog_inquiry' | 'backlog_started';

export const BACKLOG_REFUSAL_TEXT: Record<BacklogRefusal, string> = {
  task_settled: 'This task is finished.',
  backlog_inquiry: 'Only builds and operations can wait.',
  backlog_started: 'This task has started building.',
};

export function canWaitInBacklog(task: Task) {
  const pipeline = resolveTaskPipeline(task);
  return pipeline.includes('plan') && Option.isNone(resolveInquiryStep(pipeline));
}

export function resolveBacklogRefusal(task: Task): Option.Option<BacklogRefusal> {
  if (isTaskSettled(task)) return Option.some('task_settled');
  if (!canWaitInBacklog(task)) return Option.some('backlog_inquiry');
  const started = task.plan?.approvedAt || task.phaseReports.length > 0 || !BEFORE_BUILD.has(task.stage);
  return started ? Option.some('backlog_started') : Option.none();
}
