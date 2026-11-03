import { isDesktop, notifyDesktop } from '@/lib/desktop.ts';
import { readNotificationPreferences } from '@/lib/preferences/notifications.ts';

const WELCOMED_KEY = 'shinsa.notifications-welcomed';

export const WELCOME_NOTICE = {
  title: 'Notifications are on',
  body: 'Shinsa tells you here when a task needs you.',
  tag: 'shinsa-welcome',
  path: null,
};

export function showNotificationWelcome() {
  if (!isDesktop() || localStorage.getItem(WELCOMED_KEY) === 'true') return false;
  if (readNotificationPreferences().notify === 'never') return false;
  notifyDesktop(WELCOME_NOTICE);
  localStorage.setItem(WELCOMED_KEY, 'true');
  return true;
}
