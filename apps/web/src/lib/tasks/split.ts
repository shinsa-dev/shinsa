import type { PlanSplitPart, Task } from '@shinsa/core';

export const KEEP_ONE_TASK_MESSAGE = 'Keep this as one task: drop the split and plan all of the work here.';

export interface SplitPartView {
  title: string;
  request: string;
  start: string;
}

function describeTarget(parts: readonly PlanSplitPart[], on: number) {
  return on === 0 ? 'this task' : (parts[on - 1]?.title ?? `part ${on}`);
}

function describeStart(parts: readonly PlanSplitPart[], part: PlanSplitPart) {
  if (part.order === 'parallel' || part.on === undefined) return 'Starts now';
  const target = describeTarget(parts, part.on);
  return part.order === 'waits_on' ? `Waits on ${target}` : `Stacks on ${target}`;
}

export function listSplitParts(task: Task): SplitPartView[] {
  const parts = task.plan?.document?.split ?? [];
  return parts.map((part) => ({
    title: part.title,
    request: part.request,
    start: describeStart(parts, part),
  }));
}

export function countSplitTasks(task: Task) {
  const parts = task.plan?.document?.split?.length ?? 0;
  return parts === 0 ? 0 : parts + 1;
}
