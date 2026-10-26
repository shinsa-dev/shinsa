import { createSignal } from '@/lib/signal.ts';

const FONT_SIZE_KEY = 'shinsa.terminal-font-size';

export const TERMINAL_FONT_SIZE = { min: 9, max: 24, initial: 12 } as const;

export type FontSizeChange = 'larger' | 'smaller' | 'reset';

const fontSizes = createSignal();

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
