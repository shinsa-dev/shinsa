import type { IconName } from '@shinsa/ui/components/icon';
import { useSyncExternalStore } from 'react';
import { createSignal } from '@/lib/signal.ts';

export type ThemePreference = 'system' | 'light' | 'dark';

export const THEME_ITEMS: { value: ThemePreference; label: string; icon: IconName; keywords: string[] }[] = [
  { value: 'system', label: 'System', icon: 'IconWindow', keywords: ['auto', 'theme'] },
  { value: 'light', label: 'Light', icon: 'IconSun', keywords: ['theme', 'day'] },
  { value: 'dark', label: 'Dark', icon: 'IconMoon', keywords: ['theme', 'night'] },
];

const STORAGE_KEY = 'shinsa.theme';

const DARK_QUERY = '(prefers-color-scheme: dark)';

const signal = createSignal();

export function readThemePreference(): ThemePreference {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

function applyTheme(preference: ThemePreference) {
  const dark = preference === 'dark' || (preference === 'system' && matchMedia(DARK_QUERY).matches);
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.classList.toggle('light', !dark);
}

export function writeThemePreference(preference: ThemePreference) {
  localStorage.setItem(STORAGE_KEY, preference);
  applyTheme(preference);
  signal.publish();
}

export function useThemePreference() {
  return useSyncExternalStore(signal.subscribe, readThemePreference);
}

export function followSystemTheme() {
  applyTheme(readThemePreference());
  const media = matchMedia(DARK_QUERY);
  const onChange = () => applyTheme(readThemePreference());
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}
