import { compareTasks, isTaskSettled, isWatchHome, type ShinsaState, type Task } from '@shinsa/core';
import { useSyncExternalStore } from 'react';
import { sendCommandWithToast } from '@/lib/connection/commands.ts';
import { createSignal } from '@/lib/signal.ts';

export const DUPLICATE_TITLE = 'Close as a duplicate';

export const DUPLICATE_DESCRIPTION =
  'Pick the task this one repeats. This task is cancelled, its agents stop and its worktree is removed, and it links the task you pick.';

const duplicateSignal = createSignal();

let closing: string | null = null;

export function openDuplicateDialog(taskId: string) {
  closing = taskId;
  duplicateSignal.publish();
}

export function closeDuplicateDialog() {
  closing = null;
  duplicateSignal.publish();
}

export function useDuplicateDialog() {
  return useSyncExternalStore(duplicateSignal.subscribe, () => closing);
}

export function listDuplicateChoices(state: ShinsaState, task: Task) {
  const candidates = Object.values(state.tasks).filter(
    (candidate) => candidate.id !== task.id && !candidate.duplicate && !isWatchHome(candidate)
  );
  const open = candidates.filter((candidate) => !isTaskSettled(candidate)).sort(compareTasks);
  const settled = candidates
    .filter((candidate) => isTaskSettled(candidate))
    .sort((a, b) => b.stageChangedAt - a.stageChangedAt);
  return [...open, ...settled];
}

export function resolveDuplicateChoiceValue(task: Task) {
  return `${task.handle ?? ''} ${task.title} ${task.id}`.trim();
}

export function closeAsDuplicate(task: Task, original: Task) {
  return sendCommandWithToast(
    { type: 'task.mark_duplicate', taskId: task.id, duplicateOf: original.id },
    `Closed as a duplicate of ${original.handle ?? original.title}.`
  );
}

export function startNotDuplicate(task: Task) {
  return sendCommandWithToast(
    { type: 'task.clear_duplicate', taskId: task.id },
    'Started again, as not a duplicate.'
  );
}
