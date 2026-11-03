import { isDesktop, notifyDesktop } from '@/lib/desktop.ts';
import type { DecisionNotice } from './attention.ts';
import { type NotificationWorker, selectNotificationWorker } from './worker.ts';

type NotificationPermissionState = NotificationPermission | 'unsupported';

export function readNotificationPermission(): NotificationPermissionState {
  if (isDesktop()) return 'granted';
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

export function requestNotificationPermission(): Promise<NotificationPermissionState> {
  const current = readNotificationPermission();
  if (current !== 'default') return Promise.resolve(current);
  return Notification.requestPermission();
}

export const TEST_NOTIFICATION = {
  title: 'Test notification',
  body: 'Shinsa shows a decision that needs you like this.',
};

interface BrowserNotice {
  title: string;
  body: string;
  tag: string;
  path: string | null;
}

function showBrowserNotification(
  notice: BrowserNotice,
  open: ((path: string) => void) | null,
  worker: NotificationWorker | null
) {
  const options = { body: notice.body, tag: notice.tag };
  if (worker) {
    void worker.ready.then((registration) =>
      registration.showNotification(notice.title, { ...options, data: { path: notice.path } })
    );
    return;
  }
  const notification = new Notification(notice.title, options);
  notification.onclick = () => {
    notification.close();
    window.focus();
    if (notice.path && open) open(notice.path);
  };
}

export function showTestNotification(worker = selectNotificationWorker()) {
  if (notifyDesktop({ ...TEST_NOTIFICATION, tag: 'shinsa-test', path: null })) return;
  showBrowserNotification({ ...TEST_NOTIFICATION, tag: 'shinsa-test', path: null }, null, worker);
}

export function showDecisionNotification(
  notice: DecisionNotice,
  path: string,
  open: (path: string) => void,
  worker = selectNotificationWorker()
) {
  if (readNotificationPermission() !== 'granted') return false;
  showBrowserNotification({ title: notice.title, body: notice.body, tag: notice.gateId, path }, open, worker);
  return true;
}
