import type { RemoteSnapshot, Task } from '@shinsa/core';
import { useSyncExternalStore } from 'react';
import { sendCommandWithToast } from '@/lib/connection/commands.ts';
import { createSignal } from '@/lib/signal.ts';

export const SHARE_TITLE = 'Share task';

export const SHARE_DESCRIPTION =
  'Anyone with the link can watch this whole task live, read-only and without signing in: its plan, review, checks, evidence, activity and code, for a private repository too. It is read from this machine while it is online. Chats, and messages and answers to agents, never leave this machine.';

export const SHARE_NEEDS_REMOTE =
  'A link reads this task from this machine through remote access. Turn it on in Settings, then share this task.';

export type ShareView =
  | { kind: 'unpaired' }
  | { kind: 'off' }
  | { kind: 'linking' }
  | { kind: 'failed'; message: string }
  | { kind: 'shared'; url: string };

const shareSignal = createSignal();

let sharing: string | null = null;

export function openShareDialog(taskId: string) {
  sharing = taskId;
  shareSignal.publish();
}

export function closeShareDialog() {
  sharing = null;
  shareSignal.publish();
}

export function useShareDialog() {
  return useSyncExternalStore(shareSignal.subscribe, () => sharing);
}

export function resolveShareView(task: Task, remote: RemoteSnapshot | null): ShareView {
  const share = task.share;
  if (share?.failure) return { kind: 'failed', message: share.failure };
  if (share?.url) return { kind: 'shared', url: share.url };
  if (share) return { kind: 'linking' };
  if (remote && !remote.paired) return { kind: 'unpaired' };
  return { kind: 'off' };
}

export function shareTask(task: Task) {
  return sendCommandWithToast({ type: 'task.share', taskId: task.id });
}

export function unshareTask(task: Task) {
  return sendCommandWithToast(
    { type: 'task.unshare', taskId: task.id },
    'Stopped sharing. The link no longer opens this task.'
  );
}
