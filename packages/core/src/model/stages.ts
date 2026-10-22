import type { Task, TaskPriority, TaskStage } from './types.ts';

export const TERMINAL_STAGES: ReadonlySet<TaskStage> = new Set<TaskStage>(['merged', 'done', 'cancelled']);

export const RUN_STAGES: ReadonlySet<TaskStage> = new Set<TaskStage>([
  'planning',
  'building',
  'reviewing',
  'fixing',
]);

export const PRIORITY_RANK: Record<TaskPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

export function isTaskSettled(task: Task) {
  return TERMINAL_STAGES.has(task.stage);
}

export function isTaskComplete(task: Task) {
  return task.stage === 'merged' || task.stage === 'done';
}

export function compareTasks(a: Task, b: Task) {
  return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.createdAt - b.createdAt;
}
