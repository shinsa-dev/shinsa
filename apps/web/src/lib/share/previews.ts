import type { PreviewShare, RemoteSnapshot, ServiceView, ShareLimit, Task } from '@shinsa/core';
import { useSyncExternalStore } from 'react';
import { sendCommandWithToast } from '@/lib/connection/commands.ts';
import { formatUntil } from '@/lib/format/time.ts';
import { type ShareView, UNSHARE_TITLE } from '@/lib/share/dialog.ts';
import { createSignal } from '@/lib/signal.ts';

export const PREVIEW_SHARE_TITLE = 'Share preview';

export const PREVIEW_SHARED_TITLE = 'Sharing preview';

export const PREVIEW_LINK_TITLE = 'Preview link';

export const PREVIEW_SHARE_DESCRIPTION =
  'Anyone with the link can open this service from any browser while it runs on this machine.';

export const PREVIEW_NEEDS_REMOTE =
  'A preview link reaches this service through remote access. Turn it on in Settings, then share the preview.';

const PREVIEW_UNSHARE_DONE = 'Stopped sharing the preview.';

export { UNSHARE_TITLE };

export interface PreviewTarget {
  taskId: string;
  serviceId: string;
}

const previewSignal = createSignal();

let opened: PreviewTarget | null = null;

export function openPreviewShareDialog(next: PreviewTarget) {
  opened = next;
  previewSignal.publish();
}

export function closePreviewShareDialog() {
  opened = null;
  previewSignal.publish();
}

export function usePreviewShareDialog() {
  return useSyncExternalStore(previewSignal.subscribe, () => opened);
}

export function resolvePreviewTarget(view: ServiceView): PreviewTarget | null {
  return view.taskId ? { taskId: view.taskId, serviceId: view.service.id } : null;
}

export function selectLivePreview(task: Task, serviceId: string, now = Date.now()) {
  const preview = task.previews?.find((entry) => entry.serviceId === serviceId);
  if (!preview || (preview.endsAt !== null && preview.endsAt <= now)) return null;
  return preview;
}

export function isPreviewShared(task: Task, serviceId: string, now = Date.now()) {
  const preview = selectLivePreview(task, serviceId, now);
  return Boolean(preview?.url && !preview.failure);
}

export function resolvePreviewShareView(
  task: Task,
  serviceId: string,
  remote: RemoteSnapshot | null,
  now = Date.now()
): ShareView {
  const preview = selectLivePreview(task, serviceId, now);
  if (preview?.failure) return { kind: 'failed', message: preview.failure };
  if (preview?.url) return { kind: 'shared', url: preview.url };
  if (preview) return { kind: 'linking' };
  if (remote && !remote.paired) return { kind: 'unpaired' };
  return { kind: 'off' };
}

export function describePreviewEnd(preview: PreviewShare, now = Date.now()) {
  if (preview.endsAt !== null) return formatUntil('Sharing ends', preview.endsAt, now);
  if (preview.limit === 'until_done') return 'Sharing ends when the task is done';
  return 'Shared until you stop it or the task is done';
}

export function sharePreview(target: PreviewTarget, limit: ShareLimit) {
  return sendCommandWithToast({ type: 'preview.share', ...target, limit });
}

export function unsharePreview(target: PreviewTarget) {
  return sendCommandWithToast({ type: 'preview.unshare', ...target }, PREVIEW_UNSHARE_DONE);
}
