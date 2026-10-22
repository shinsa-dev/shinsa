import { useSyncExternalStore } from 'react';
import { createSignal } from '@/lib/state/signal.ts';

const signal = createSignal();

export function readFlag(key: string, fallback: boolean) {
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
