import { isTaskSettled, type Task, type TaskGuest } from '@shinsa/core';
import { useSyncExternalStore } from 'react';
import { sendCommandWithToast } from '@/lib/connection/commands.ts';
import { describeUserName } from '@/lib/remote/users.ts';
import { createSignal } from '@/lib/signal.ts';

export const HANDOFF_TITLE = 'Hand off';

export const HANDOFF_DESCRIPTION =
  'Send a link to the person taking over. The first GitHub account to open it works on this task from their own Shinsa, and reaches nothing else on this machine.';

export const HANDOFF_COPY = 'Copy hand-off link';

export const HANDOFF_REMOVE = 'Remove';

export const HANDOFF_REMOVE_DESCRIPTION =
  'They lose this task at once. To hand it to someone else, hand it off again for a new link.';

export type HandoffView =
  | { kind: 'off' }
  | { kind: 'linking' }
  | { kind: 'failed'; message: string }
  | { kind: 'ready'; url: string }
  | { kind: 'claimed'; guest: TaskGuest; at: number };

const handoffSignal = createSignal();

let removing: string | null = null;

export function openHandoffRemoveConfirm(taskId: string) {
  removing = taskId;
  handoffSignal.publish();
}

export function closeHandoffRemoveConfirm() {
  removing = null;
  handoffSignal.publish();
}

export function useHandoffRemoveConfirm() {
  return useSyncExternalStore(handoffSignal.subscribe, () => removing);
}

export function canHandOff(task: Task) {
  if (task.handoff) return true;
  return !task.watchHome && !isTaskSettled(task);
}

export function resolveHandoffView(task: Task): HandoffView {
  const handoff = task.handoff;
  if (!handoff) return { kind: 'off' };
  if (handoff.guest) return { kind: 'claimed', guest: handoff.guest, at: handoff.claimedAt ?? handoff.at };
  if (handoff.failure) return { kind: 'failed', message: handoff.failure };
  if (handoff.url) return { kind: 'ready', url: handoff.url };
  return { kind: 'linking' };
}

export function describeHandoffClaim(guest: TaskGuest) {
  return `${describeUserName(guest)} took this task over`;
}

export function handOffTask(task: Task) {
  return sendCommandWithToast({ type: 'task.hand_off', taskId: task.id });
}

export function removeHandoff(task: Task) {
  const guest = task.handoff?.guest;
  const done = guest ? `${describeUserName(guest)} no longer has this task.` : 'The hand-off link is off.';
  return sendCommandWithToast({ type: 'handoff.remove', taskId: task.id }, done);
}
