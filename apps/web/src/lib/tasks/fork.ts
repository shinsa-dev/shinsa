import { useSyncExternalStore } from 'react';
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
