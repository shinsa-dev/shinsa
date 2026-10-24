import { useSyncExternalStore } from 'react';
import { createSignal } from '@/lib/signal.ts';

const signal = createSignal();

function readFlag(key: string, fallback: boolean) {
  const stored = localStorage.getItem(key);
  return stored === null ? fallback : stored === 'true';
}

export function writeFlag(key: string, value: boolean) {
  localStorage.setItem(key, String(value));
  signal.publish();
}

export function useStoredFlag(key: string, fallback: boolean) {
  return useSyncExternalStore(signal.subscribe, () => readFlag(key, fallback));
}

export function useStoredToggle(key: string, fallback: boolean) {
  const value = useStoredFlag(key, fallback);
  return [value, () => writeFlag(key, !value)] as const;
}
