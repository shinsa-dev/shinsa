import type { IconName } from '@shinsa/ui/components/icon';
import { useSyncExternalStore } from 'react';
import { createSignal } from '@/lib/signal.ts';

export type LayoutPreference = 'sidebar' | 'cards';

export const LAYOUT_NAMES: Record<LayoutPreference, { label: string; hint: string; icon: IconName }> = {
  cards: {
    label: 'Desk',
    hint: 'Pages sit centred with nothing at the sides, and a button at the top opens what needs you.',
    icon: 'IconLayoutGrid1',
  },
  sidebar: {
    label: 'Shelf',
    hint: 'A rail at the side lists every task and stays open, so each one is a click away.',
    icon: 'IconSidebar',
  },
};

export const LAYOUT_ORDER: LayoutPreference[] = ['cards', 'sidebar'];

const STORAGE_KEY = 'shinsa.layout';

const signal = createSignal();

function parseLayout(value: string | null): LayoutPreference | null {
  return value === 'sidebar' || value === 'cards' ? value : null;
}

function readLayoutPreference(): LayoutPreference {
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
