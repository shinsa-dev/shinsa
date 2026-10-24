import { useSyncExternalStore } from 'react';
import { createSignal } from '@/lib/signal.ts';

export type AlertPreference = 'never' | 'unfocused' | 'always';

export type SoundId = 'chime' | 'ping' | 'pop';

export interface NotificationPreferences {
  sound: AlertPreference;
  soundId: SoundId;
  notify: AlertPreference;
}

const SOUND_KEY = 'shinsa.sound';

const SOUND_ID_KEY = 'shinsa.sound-id';

const NOTIFY_KEY = 'shinsa.notifications';

const ALERTS: readonly AlertPreference[] = ['never', 'unfocused', 'always'];

const SOUND_IDS: readonly SoundId[] = ['chime', 'ping', 'pop'];

export const DEFAULT_PREFERENCES: NotificationPreferences = {
  sound: 'unfocused',
  soundId: 'chime',
  notify: 'never',
};

const signal = createSignal();

let cached: { key: string; value: NotificationPreferences } | null = null;

function readOne<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  const stored = localStorage.getItem(key);
  return allowed.includes(stored as T) ? (stored as T) : fallback;
}

export function readNotificationPreferences(): NotificationPreferences {
  const value: NotificationPreferences = {
    sound: readOne(SOUND_KEY, ALERTS, DEFAULT_PREFERENCES.sound),
    soundId: readOne(SOUND_ID_KEY, SOUND_IDS, DEFAULT_PREFERENCES.soundId),
    notify: readOne(NOTIFY_KEY, ALERTS, DEFAULT_PREFERENCES.notify),
  };
  const key = `${value.sound}/${value.soundId}/${value.notify}`;
  if (cached?.key !== key) cached = { key, value };
  return cached.value;
}

export function writeNotificationPreferences(patch: Partial<NotificationPreferences>) {
  if (patch.sound) localStorage.setItem(SOUND_KEY, patch.sound);
  if (patch.soundId) localStorage.setItem(SOUND_ID_KEY, patch.soundId);
  if (patch.notify) localStorage.setItem(NOTIFY_KEY, patch.notify);
  signal.publish();
}

export function useNotificationPreferences() {
  return useSyncExternalStore(signal.subscribe, readNotificationPreferences);
}
