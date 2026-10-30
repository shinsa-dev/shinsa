import { toast } from '@shinsa/ui/components/sonner';
import { openDesktopNotificationSettings } from '@/lib/desktop.ts';
import {
  type NotificationPreferences,
  writeNotificationPreferences,
} from '@/lib/preferences/notifications.ts';
import {
  readNotificationPermission,
  requestNotificationPermission,
  showTestNotification,
} from './browser.ts';
import { playSound } from './sounds.ts';

export const BLOCKED =
  'Your browser blocks notifications from Shinsa. Allow them in the site settings first.';

export const TEST_SOUND = 'Play the sound';

export const TEST_BOTH = 'Play the sound and show a test notification';

export const UNSUPPORTED = 'This browser cannot show notifications.';

export const HANDLED_BY_APP = 'The Shinsa app is open and handles notifications, so this page stays quiet.';

export const MACOS_NOTIFICATIONS = 'macOS notifications';

export const MACOS_NOTIFICATIONS_HINT =
  'Banners and the Dock badge only show while macOS allows notifications for Shinsa.';

export const OPEN_MACOS_SETTINGS = 'Open settings';

export const NOTIFY_BLOCKED =
  'macOS blocked a notification. Allow notifications for Shinsa in System Settings.';

const NOTIFY_BLOCKED_TOAST = 'notify-blocked';

export function showNotifyBlocked() {
  toast.error(NOTIFY_BLOCKED, {
    id: NOTIFY_BLOCKED_TOAST,
    action: { label: OPEN_MACOS_SETTINGS, onClick: openDesktopNotificationSettings },
  });
}

async function requestPermissionWithToast() {
  const permission = await requestNotificationPermission();
  if (permission === 'granted') return true;
  toast.error(permission === 'unsupported' ? UNSUPPORTED : BLOCKED);
  return false;
}

export async function updateNotifications(patch: Partial<NotificationPreferences>) {
  if (patch.notify && patch.notify !== 'never' && !(await requestPermissionWithToast())) return false;
  writeNotificationPreferences(patch);
  return true;
}

export function needsTestNotification(preferences: NotificationPreferences) {
  return preferences.notify !== 'never' || readNotificationPermission() === 'granted';
}

export async function testNotifications(preferences: NotificationPreferences) {
  void playSound(preferences.soundId);
  if (!needsTestNotification(preferences)) return false;
  if (!(await requestPermissionWithToast())) return false;
  showTestNotification();
  return true;
}
