import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { TEST_NOTIFICATION } from '@/lib/notifications/browser.ts';
import {
  BLOCKED,
  NOTIFY_BLOCKED,
  needsTestNotification,
  OPEN_MACOS_SETTINGS,
  showNotifyBlocked,
  testNotifications,
  UNSUPPORTED,
  updateNotifications,
} from '@/lib/notifications/settings.ts';
import { readNotificationPreferences } from '@/lib/preferences/notifications.ts';
import { spyOnToasts } from '../../support/commands.ts';
import { installDesktop } from '../../support/desktop.ts';
import { installAudio, installNotifications } from '../../support/notifications.ts';

let toasts: ReturnType<typeof spyOnToasts>;

beforeEach(() => {
  toasts = spyOnToasts();
});

afterEach(() => {
  toasts.restore();
});

describe('changing notification settings', () => {
  it('saves sound settings without asking the browser anything', async () => {
    expect(await updateNotifications({ sound: 'always', soundId: 'ping', notify: 'never' })).toBe(true);
    expect(readNotificationPreferences()).toEqual({ sound: 'always', soundId: 'ping', notify: 'never' });
  });

  it('turns notifications on only once the browser allows them', async () => {
    const fake = installNotifications('default', 'granted');
    expect(await updateNotifications({ notify: 'always' })).toBe(true);
    expect(readNotificationPreferences().notify).toBe('always');
    fake.restore();
  });

  it('keeps notifications off and says why when the browser blocks them or has none', async () => {
    const fake = installNotifications('default', 'denied');
    expect(await updateNotifications({ notify: 'unfocused' })).toBe(false);
    fake.restore();
    expect(await updateNotifications({ notify: 'unfocused' })).toBe(false);
    expect(readNotificationPreferences().notify).toBe('never');
    expect(toasts.error.mock.calls.map(([message]) => message)).toEqual([BLOCKED, UNSUPPORTED]);
  });
});

describe('testing the sound and notifications', () => {
  const preferences = { sound: 'unfocused', soundId: 'pop', notify: 'never' } as const;

  it('plays the sound alone while notifications are off and the browser has not allowed them', async () => {
    const audio = installAudio();
    const fake = installNotifications('default');
    expect(needsTestNotification(preferences)).toBe(false);
    expect(await testNotifications(preferences)).toBe(false);
    expect(audio.played.length).toBeGreaterThan(0);
    expect(fake.shown).toEqual([]);
    expect(fake.requests).toEqual([]);
    fake.restore();
    audio.restore();
  });

  it('shows a test notification once the browser allows them, and focuses Shinsa on a click', async () => {
    const fake = installNotifications('granted');
    expect(needsTestNotification(preferences)).toBe(true);
    expect(await testNotifications(preferences)).toBe(true);
    expect(fake.shown.map((shown) => [shown.title, shown.options.body])).toEqual([
      [TEST_NOTIFICATION.title, TEST_NOTIFICATION.body],
    ]);
    fake.shown[0]?.click();
    expect(fake.shown[0]?.closed).toBe(true);
    fake.restore();
  });

  it('asks the browser when notifications are on, and says why it cannot show one', async () => {
    const asked = installNotifications('default', 'granted');
    expect(await testNotifications({ ...preferences, notify: 'always' })).toBe(true);
    expect(asked.requests).toHaveLength(1);
    asked.restore();
    const blocked = installNotifications('denied');
    expect(await testNotifications({ ...preferences, notify: 'always' })).toBe(false);
    blocked.restore();
    expect(await testNotifications({ ...preferences, notify: 'always' })).toBe(false);
    expect(toasts.error.mock.calls.map(([message]) => message)).toEqual([BLOCKED, UNSUPPORTED]);
  });
});

describe('when macOS blocks a notification', () => {
  it('says so once, with an action that opens macOS notification settings', () => {
    const desktop = installDesktop();
    try {
      showNotifyBlocked();
      const [message, options] = toasts.error.mock.calls[0] ?? [];
      expect(message).toBe(NOTIFY_BLOCKED);
      expect(options?.id).toBe('notify-blocked');
      const action = options?.action as { label: string; onClick: () => void };
      expect(action.label).toBe(OPEN_MACOS_SETTINGS);
      action.onClick();
      expect(desktop.settingsOpened()).toBe(1);
    } finally {
      desktop.restore();
    }
  });
});
