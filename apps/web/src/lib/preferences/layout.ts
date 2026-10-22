import { useSyncExternalStore } from 'react';
import { createSignal } from '@/lib/state/signal.ts';

export type LayoutPreference = 'sidebar' | 'cards';

const STORAGE_KEY = 'shinsa.layout';

const signal = createSignal();

function parseLayout(value: string | null): LayoutPreference | null {
  return value === 'sidebar' || value === 'cards' ? value : null;
}

export function readLayoutPreference(): LayoutPreference {
  return parseLayout(localStorage.getItem(STORAGE_KEY)) ?? 'cards';
}

export function writeLayoutPreference(layout: LayoutPreference) {
  localStorage.setItem(STORAGE_KEY, layout);
  signal.publish();
}

export function applyLayoutParam(search = location.search) {
  const requested = parseLayout(new URLSearchParams(search).get('layout'));
  if (requested) writeLayoutPreference(requested);
}

export function useLayoutPreference() {
  return useSyncExternalStore(signal.subscribe, readLayoutPreference);
}
