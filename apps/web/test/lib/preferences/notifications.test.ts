import { describe, expect, it } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import {
  DEFAULT_PREFERENCES,
  readNotificationPreferences,
  useNotificationPreferences,
  writeNotificationPreferences,
} from '@/lib/preferences/notifications.ts';

describe('notification preferences', () => {
  it('start quiet: a sound in the background, no notifications', () => {
    expect(readNotificationPreferences()).toEqual(DEFAULT_PREFERENCES);
    expect(DEFAULT_PREFERENCES).toEqual({ sound: 'unfocused', soundId: 'chime', notify: 'never' });
  });

  it('ignore a stored value they do not know', () => {
    localStorage.setItem('shinsa.sound', 'loud');
    localStorage.setItem('shinsa.sound-id', 'gong');
    localStorage.setItem('shinsa.notifications', 'sometimes');
    expect(readNotificationPreferences()).toEqual(DEFAULT_PREFERENCES);
  });

  it('keep the same object until something changes, so React does not loop', () => {
    const first = readNotificationPreferences();
    expect(readNotificationPreferences()).toBe(first);
    writeNotificationPreferences({ soundId: 'pop' });
    expect(readNotificationPreferences()).not.toBe(first);
  });

  it('save each part on its own and tell every reader', () => {
    const { result } = renderHook(() => useNotificationPreferences());
    act(() => writeNotificationPreferences({ sound: 'always' }));
    act(() => writeNotificationPreferences({ notify: 'unfocused' }));
    expect(result.current).toEqual({ sound: 'always', soundId: 'chime', notify: 'unfocused' });
  });
});
