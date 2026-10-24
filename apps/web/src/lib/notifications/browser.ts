import { isDesktop, notifyDesktop } from '@/lib/desktop.ts';
import type { DecisionNotice } from './attention.ts';

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

export function showTestNotification() {
  if (notifyDesktop({ ...TEST_NOTIFICATION, tag: 'shinsa-test', path: null })) return;
  const notification = new Notification(TEST_NOTIFICATION.title, {
    body: TEST_NOTIFICATION.body,
    tag: 'shinsa-test',
  });
  notification.onclick = () => {
    notification.close();
    window.focus();
  };
}

export function showDecisionNotification(notice: DecisionNotice, open: (taskId: string) => void) {
  if (readNotificationPermission() !== 'granted') return false;
  const notification = new Notification(notice.title, { body: notice.body, tag: notice.gateId });
  notification.onclick = () => {
    notification.close();
    window.focus();
    open(notice.taskId);
  };
  return true;
}
