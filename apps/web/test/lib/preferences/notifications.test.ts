import { describe, expect, it } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import {
  DEFAULT_PREFERENCES,
  readNotificationPreferences,
  useNotificationPreferences,
  writeNotificationPreferences,
} from '@/lib/preferences/notifications.ts';
import { installDesktop } from '../../support/desktop.ts';

describe('notification preferences', () => {
  it('start quiet: a sound in the background, no notifications', () => {
    expect(readNotificationPreferences()).toEqual(DEFAULT_PREFERENCES);
    expect(DEFAULT_PREFERENCES).toEqual({
      sound: 'unfocused',
      soundId: 'chime',
      notify: 'never',
      details: true,
    });
  });

  it('notify in the background by default in the desktop app', () => {
    const desktop = installDesktop();
    expect(readNotificationPreferences()).toEqual({ ...DEFAULT_PREFERENCES, notify: 'unfocused' });
    writeNotificationPreferences({ notify: 'never' });
    expect(readNotificationPreferences().notify).toBe('never');
    desktop.restore();
  });

  it('ignore a stored value they do not know', () => {
    localStorage.setItem('shinsa.sound', 'loud');
    localStorage.setItem('shinsa.sound-id', 'gong');
    localStorage.setItem('shinsa.notifications', 'sometimes');
    localStorage.setItem('shinsa.notification-details', 'maybe');
    expect(readNotificationPreferences()).toEqual(DEFAULT_PREFERENCES);
  });

  it('keep the same object until something changes, so React does not loop', () => {
    const first = readNotificationPreferences();
    expect(readNotificationPreferences()).toBe(first);
    writeNotificationPreferences({ soundId: 'pop' });
    expect(readNotificationPreferences()).not.toBe(first);
  });

  it('keep task details on until you turn them off, and remember it', () => {
    expect(readNotificationPreferences().details).toBe(true);
    writeNotificationPreferences({ details: false });
    expect(localStorage.getItem('shinsa.notification-details')).toBe('false');
    expect(readNotificationPreferences().details).toBe(false);
    writeNotificationPreferences({ details: true });
    expect(readNotificationPreferences().details).toBe(true);
  });

  it('save each part on its own and tell every reader', () => {
    const { result } = renderHook(() => useNotificationPreferences());
    act(() => writeNotificationPreferences({ sound: 'always' }));
    act(() => writeNotificationPreferences({ notify: 'unfocused' }));
    expect(result.current).toEqual({
      sound: 'always',
      soundId: 'chime',
      notify: 'unfocused',
      details: true,
    });
  });
});
