import { toast } from '@shinsa/ui/components/sonner';
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
