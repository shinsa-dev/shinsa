import type { ShinsaState, Task } from '@shinsa/core';
import { useSyncExternalStore } from 'react';
import { sendCommandWithToast } from '@/lib/connection/commands.ts';
import { createSignal } from '@/lib/signal.ts';

export const FORK_TITLE = 'Fork into a new task';

export const FORK_DESCRIPTION =
  'The new task gets its own branch, review and pull request, and its agent starts from a copy of this task’s conversation, so it knows what was done here.';

const forkSignal = createSignal();

let forking: string | null = null;

export function openForkDialog(taskId: string) {
  forking = taskId;
  forkSignal.publish();
}

export function closeForkDialog() {
  forking = null;
  forkSignal.publish();
}

export function useForkDialog() {
  return useSyncExternalStore(forkSignal.subscribe, () => forking);
}

export function forkTask(state: ShinsaState, task: Task, request: string) {
  const projectId = task.projectId ?? (task.repoId ? (state.repos[task.repoId]?.projectId ?? null) : null);
  return sendCommandWithToast(
    { type: 'task.create', request, repoId: task.repoId, projectId, forkOf: task.id },
    `Forked ${task.handle ?? task.title} into a new task.`
  );
}
