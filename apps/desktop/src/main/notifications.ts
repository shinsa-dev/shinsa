import { Notification } from 'electron';
import type { DesktopNotice } from '../lib/bridge.ts';

const shown = new Map<string, Notification>();

let onFailed: (() => void) | null = null;

export function watchNoticeFailures(listener: () => void) {
  onFailed = listener;
}

export function showNotice(notice: DesktopNotice, open: (path: string | null) => void) {
  if (!Notification.isSupported()) return;
  shown.get(notice.tag)?.close();
  const notification = new Notification({ title: notice.title, body: notice.body, silent: true });
  shown.set(notice.tag, notification);
  const forget = () => {
    if (shown.get(notice.tag) === notification) shown.delete(notice.tag);
  };
  notification.on('click', () => {
    forget();
    open(notice.path);
  });
  notification.on('close', forget);
  notification.on('failed', () => {
    forget();
    onFailed?.();
  });
  notification.show();
}
