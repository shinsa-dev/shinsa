import type { Task } from '@shinsa/core';
import { resolvePlanReply } from '@/lib/tasks/gates.ts';
import { countSplitTasks } from '@/lib/tasks/split.ts';

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

function describeSplitCard(task: Task, count: number): PlanCardCopy {
  return {
    title: task.backlog
      ? `Planned as ${count} tasks and kept in the backlog`
      : `The agent wants to split this into ${count} tasks`,
    approve: `Start ${count} tasks`,
    note: 'Each other part becomes its own task and plans for itself. To change the parts, say it in the chat.',
  };
}

export function describePlanCard(task: Task): PlanCardCopy {
  const count = countSplitTasks(task);
  if (count > 0) return describeSplitCard(task, count);
  if (!task.backlog) return NEEDS_YOU;
  return {
    title: 'Planned and kept in the backlog',
    approve: resolvePlanReply(task) === 'approveOperationPlan' ? 'Start the operation' : 'Start building',
    note: 'Starting moves the worktree onto the latest default branch first. To change the plan, say it in the chat.',
  };
}
