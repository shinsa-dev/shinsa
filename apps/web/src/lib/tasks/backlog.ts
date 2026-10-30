import type { Task } from '@shinsa/core';
import { runTaskAction } from '@/lib/tasks/actions.ts';
import { resolvePlanReply } from '@/lib/tasks/gates.ts';

export interface PlanCardCopy {
  title: string;
  approve: string;
  note: string;
}

const NEEDS_YOU: PlanCardCopy = {
  title: 'The agent wants your go-ahead on this plan',
  approve: 'Approve plan',
  note: 'Want something different? Say it in the chat and the agent revises it.',
};

export function describePlanCard(task: Task): PlanCardCopy {
  if (!task.backlog) return NEEDS_YOU;
  return {
    title: 'Planned and kept in the backlog',
    approve: resolvePlanReply(task) === 'approveOperationPlan' ? 'Start the operation' : 'Start building',
    note: 'Starting moves the worktree onto the latest default branch first. To change the plan, say it in the chat.',
  };
}

export function requestRemoveFromBacklog(task: Task) {
  runTaskAction(task, 'removeFromBacklog');
}
