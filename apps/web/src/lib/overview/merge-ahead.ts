import { isTaskSettled, listOpenMergeSteps, type Task } from '@shinsa/core';
import { sendCommandWithToast } from '@/lib/connection/commands.ts';

export const KEEP_MERGE_GATE_LABEL = 'Keep the merge gate';

const KEPT_TOAST = 'Kept the merge gate.';

export function describeMergeAhead(task: Task) {
  if (!task.mergeAhead || isTaskSettled(task)) return null;
  const open = listOpenMergeSteps(task, 'pre_merge').length;
  if (open === 0) {
    return 'You chose to merge once ready: it merges by itself once CI is green, nothing conflicts and no comment is unread.';
  }
  const steps = open === 1 ? 'the step' : `the ${open} steps`;
  return `You chose to merge once ready: it merges as soon as you tick ${steps} before the merge.`;
}

export function requestKeepMergeGate(task: Task) {
  return sendCommandWithToast({ type: 'task.keep_merge_gate', taskId: task.id }, KEPT_TOAST);
}
