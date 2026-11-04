import { toast } from '@shinsa/ui/components/sonner';
import { Effect } from 'effect';
import { openDesktopNotificationSettings } from '@/lib/desktop.ts';
import {
  type NotificationPreferences,
  writeNotificationPreferences,
} from '@/lib/preferences/notifications.ts';
import { runApp } from '@/lib/runtime/app.ts';
import {
  readNotificationPermission,
  requestNotificationPermission,
  showTestNotification,
} from './browser.ts';
import { playSound } from './sounds.ts';

export const BLOCKED = 'Your browser blocks notifications.';

export const TEST_SOUND = 'Play the sound';

export const TEST_BOTH = 'Play the sound and show a test notification';

export const UNSUPPORTED = 'This browser cannot show notifications.';

export const HANDLED_BY_APP = 'The Shinsa app is open and handles notifications, so this page stays quiet.';

export const MACOS_NOTIFICATIONS = 'macOS notifications';

export const MACOS_NOTIFICATIONS_HINT =
  'Banners and the Dock badge only show while macOS allows notifications for Shinsa.';

export const OPEN_MACOS_SETTINGS = 'Open settings';

export const NOTIFY_BLOCKED = 'macOS blocked a notification.';

const NOTIFY_BLOCKED_TOAST = 'notify-blocked';

export function showNotifyBlocked() {
  toast.error(NOTIFY_BLOCKED, {
    id: NOTIFY_BLOCKED_TOAST,
    action: { label: OPEN_MACOS_SETTINGS, onClick: openDesktopNotificationSettings },
  });
}

const requestPermissionWithToast = Effect.promise(requestNotificationPermission).pipe(
  Effect.map((permission) => {
    if (permission === 'granted') return true;
    toast.error(permission === 'unsupported' ? UNSUPPORTED : BLOCKED);
    return false;
  })
);

export function updateNotifications(patch: Partial<NotificationPreferences>) {
  return runApp(
    Effect.gen(function* () {
      if (patch.notify && patch.notify !== 'never' && !(yield* requestPermissionWithToast)) return false;
      writeNotificationPreferences(patch);
      return true;
    })
  );
}

export function needsTestNotification(preferences: NotificationPreferences) {
  return preferences.notify !== 'never' || readNotificationPermission() === 'granted';
}

export function testNotifications(preferences: NotificationPreferences) {
  return runApp(
    Effect.gen(function* () {
      void playSound(preferences.soundId);
      if (!needsTestNotification(preferences)) return false;
      if (!(yield* requestPermissionWithToast)) return false;
      showTestNotification();
      return true;
    })
  );
}
