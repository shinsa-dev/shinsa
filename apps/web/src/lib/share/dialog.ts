import {
  isTaskSettled,
  type RemoteSnapshot,
  resolveShareLimit,
  resolveSharePreset,
  type Settings,
  type ShareLimit,
  type SharePreset,
  type Task,
  type TaskShare,
} from '@shinsa/core';
import type { IconName } from '@shinsa/ui/components/icon';
import { useSyncExternalStore } from 'react';
import { sendCommandWithToast } from '@/lib/connection/commands.ts';
import { formatUntil } from '@/lib/format/time.ts';
import { createSignal } from '@/lib/signal.ts';

export const SHARE_TITLE = 'Share task';

export const UNSHARE_TITLE = 'Stop sharing';

export const SHARE_MANAGE_TITLE = 'Manage';

export const SHARING_NOTE = 'Anyone with the link can watch this task.';

export const SHARE_DESCRIPTION =
  'Anyone with the link can watch it live, read-only, while this machine is online.';

export const UNSHARE_DESCRIPTION = 'The link stops working at once, for everyone who has it.';

export const SHARE_LIMIT_TITLE = 'Share for';

export const SHARED_MARK_LABEL = 'Shared by link';

export const SHARING_SECTION = 'Sharing';

export const SHARING_SECTION_DESCRIPTION =
  'What a shared task shows and for how long, unless you pick otherwise.';

export const SHARE_LIMIT_SETTING = 'Share tasks for';

export const SHARE_PRESET_TITLE = 'Share as';

export const SHARE_PRESET_SETTING = 'Share tasks as';

export const SHARE_PRESET_ITEMS: { value: SharePreset; label: string; hint: string; icon: IconName }[] = [
  {
    value: 'status',
    label: 'Status',
    hint: 'Progress for customers, no names or code',
    icon: 'IconProgress75',
  },
  {
    value: 'standard',
    label: 'Standard',
    hint: 'The task and its agents’ live work',
    icon: 'IconListBullets',
  },
  { value: 'full', label: 'Full access', hint: 'Standard and your messages', icon: 'IconEyeOpen' },
];

export function describeSharePreset(preset: SharePreset) {
  return SHARE_PRESET_ITEMS.find((item) => item.value === preset)?.label ?? preset;
}

export const SHARE_LIMIT_ITEMS: { value: ShareLimit; label: string; icon: IconName }[] = [
  { value: 'until_done', label: 'Until the task is done', icon: 'IconCheckCircle2' },
  { value: 'hour', label: '1 hour', icon: 'IconClock' },
  { value: 'day', label: '24 hours', icon: 'IconClock' },
  { value: 'week', label: '7 days', icon: 'IconClock' },
  { value: 'none', label: 'Until you stop it', icon: 'IconInfinity' },
];

const FINISHED_TASK_LIMIT: ShareLimit = 'day';

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

let stopping: string | null = null;

export function openUnshareConfirm(taskId: string) {
  stopping = taskId;
  shareSignal.publish();
}

export function closeUnshareConfirm() {
  stopping = null;
  shareSignal.publish();
}

export function useUnshareConfirm() {
  return useSyncExternalStore(shareSignal.subscribe, () => stopping);
}

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

export function selectLiveShare(task: Task, now = Date.now()) {
  const share = task.share;
  if (!share || (share.endsAt !== null && share.endsAt <= now)) return null;
  return share;
}

export function isTaskShared(task: Task, now = Date.now()) {
  const share = selectLiveShare(task, now);
  return Boolean(share?.url && !share.failure);
}

export function resolveShareView(task: Task, remote: RemoteSnapshot | null, now = Date.now()): ShareView {
  const share = selectLiveShare(task, now);
  if (share?.failure) return { kind: 'failed', message: share.failure };
  if (share?.url) return { kind: 'shared', url: share.url };
  if (share) return { kind: 'linking' };
  if (remote && !remote.paired) return { kind: 'unpaired' };
  return { kind: 'off' };
}

export function listShareLimitItems(task: Task) {
  if (!isTaskSettled(task)) return SHARE_LIMIT_ITEMS;
  return SHARE_LIMIT_ITEMS.filter((item) => item.value !== 'until_done');
}

export function resolveShareLimitChoice(task: Task, settings: Settings): ShareLimit {
  const limit = task.share?.limit ?? resolveShareLimit(settings);
  return limit === 'until_done' && isTaskSettled(task) ? FINISHED_TASK_LIMIT : limit;
}

export function resolveSharePresetChoice(task: Task, settings: Settings | null): SharePreset {
  if (task.share) return task.share.preset;
  return settings ? resolveSharePreset(settings) : 'standard';
}

export function describeShareEnd(share: TaskShare, now = Date.now()) {
  if (share.endsAt !== null) return formatUntil('Sharing ends', share.endsAt, now);
  if (share.limit === 'until_done') return 'Sharing ends when the task is done';
  return 'Shared until you stop it';
}

export function shareTask(task: Task, limit: ShareLimit, preset: SharePreset) {
  return sendCommandWithToast({ type: 'task.share', taskId: task.id, limit, preset });
}

export function changeSharePreset(task: Task, preset: SharePreset) {
  return sendCommandWithToast(
    { type: 'task.share', taskId: task.id, preset },
    `Sharing as ${describeSharePreset(preset).toLowerCase()}.`
  );
}

const SHARE_LIMIT_TOAST: Record<ShareLimit, string> = {
  until_done: 'Sharing until the task is done.',
  hour: 'Sharing for 1 hour.',
  day: 'Sharing for 24 hours.',
  week: 'Sharing for 7 days.',
  none: 'Sharing until you stop it.',
};

export function changeShareLimit(task: Task, limit: ShareLimit) {
  return sendCommandWithToast({ type: 'task.share', taskId: task.id, limit }, SHARE_LIMIT_TOAST[limit]);
}

export function unshareTask(task: Task) {
  return sendCommandWithToast({ type: 'task.unshare', taskId: task.id }, 'Stopped sharing.');
}
