import { useSyncExternalStore } from 'react';
import { createSignal } from '@/lib/signal.ts';
import { TERMINAL_FILTERS, type TerminalFilter } from '@/lib/terminal/tabs.ts';

const FONT_SIZE_KEY = 'shinsa.terminal-font-size';

export const TERMINAL_FONT_SIZE = { min: 9, max: 24, initial: 12 } as const;

export type FontSizeChange = 'larger' | 'smaller' | 'reset';

const FILTER_KEY = 'shinsa.terminal-filter';

const DEFAULT_FILTER: TerminalFilter = 'yours';

const fontSizes = createSignal();

const filters = createSignal();

export function readTerminalFontSize() {
  const stored = Number(localStorage.getItem(FONT_SIZE_KEY));
  if (!Number.isInteger(stored) || stored < TERMINAL_FONT_SIZE.min || stored > TERMINAL_FONT_SIZE.max)
    return TERMINAL_FONT_SIZE.initial;
  return stored;
}

export function resolveFontSize(current: number, change: FontSizeChange) {
  if (change === 'reset') return TERMINAL_FONT_SIZE.initial;
  const next = current + (change === 'larger' ? 1 : -1);
  return Math.min(TERMINAL_FONT_SIZE.max, Math.max(TERMINAL_FONT_SIZE.min, next));
}

export function changeTerminalFontSize(change: FontSizeChange) {
  const next = resolveFontSize(readTerminalFontSize(), change);
  if (next === TERMINAL_FONT_SIZE.initial) localStorage.removeItem(FONT_SIZE_KEY);
  else localStorage.setItem(FONT_SIZE_KEY, String(next));
  fontSizes.publish();
  return next;
}

export const subscribeTerminalFontSize = fontSizes.subscribe;

export function readTerminalFilter(): TerminalFilter {
  const stored = localStorage.getItem(FILTER_KEY);
  return TERMINAL_FILTERS.find((entry) => entry.value === stored)?.value ?? DEFAULT_FILTER;
}

export function writeTerminalFilter(filter: TerminalFilter) {
  if (filter === DEFAULT_FILTER) localStorage.removeItem(FILTER_KEY);
  else localStorage.setItem(FILTER_KEY, filter);
  filters.publish();
}

export function useTerminalFilter() {
  return useSyncExternalStore(filters.subscribe, readTerminalFilter);
}
