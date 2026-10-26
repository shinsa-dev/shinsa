import type { FontSizeChange } from '@/lib/preferences/terminal.ts';

export type TerminalKey =
  | { type: 'shell' }
  | { type: 'shinsa' }
  | { type: 'nothing' }
  | { type: 'send'; data: string }
  | { type: 'copy' }
  | { type: 'paste' }
  | { type: 'find' }
  | { type: 'select-all' }
  | { type: 'clear' }
  | { type: 'font'; change: FontSizeChange }
  | { type: 'scroll'; to: 'top' | 'bottom' | 'page-up' | 'page-down' };

export interface KeyPress {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

const ESC = '\u001b';

const COMMAND_SENDS: Record<string, string> = {
  Backspace: '\u0015',
  ArrowLeft: '\u0001',
  ArrowRight: '\u0005',
};

const OPTION_SENDS: Record<string, string> = {
  Backspace: `${ESC}\u007f`,
  ArrowLeft: `${ESC}b`,
  ArrowRight: `${ESC}f`,
};

const COMMAND_SCROLLS: Record<string, TerminalKey> = {
  Home: { type: 'scroll', to: 'top' },
  End: { type: 'scroll', to: 'bottom' },
  PageUp: { type: 'scroll', to: 'page-up' },
  PageDown: { type: 'scroll', to: 'page-down' },
};

const COMMAND_KEYS: Record<string, TerminalKey> = {
  c: { type: 'copy' },
  v: { type: 'paste' },
  f: { type: 'find' },
  a: { type: 'select-all' },
  l: { type: 'clear' },
  '=': { type: 'font', change: 'larger' },
  '+': { type: 'font', change: 'larger' },
  '-': { type: 'font', change: 'smaller' },
  '0': { type: 'font', change: 'reset' },
};

const CONTROL_SHIFT_KEYS: Record<string, TerminalKey> = {
  c: { type: 'copy' },
  v: { type: 'paste' },
  f: { type: 'find' },
  a: { type: 'select-all' },
  l: { type: 'clear' },
};

const NEWLINE: TerminalKey = { type: 'send', data: `${ESC}\r` };

function isPrintableAscii(key: string) {
  return key.length === 1 && key >= ' ' && key <= '~';
}

function resolveMacCommand(event: KeyPress, hasSelection: boolean): TerminalKey {
  if (event.ctrlKey || event.altKey) return { type: 'shinsa' };
  const sends = COMMAND_SENDS[event.key];
  if (sends && !event.shiftKey) return { type: 'send', data: sends };
  const scroll = COMMAND_SCROLLS[event.key];
  if (scroll) return scroll;
  const action = COMMAND_KEYS[event.key.toLowerCase()];
  const shifted = event.shiftKey && event.key !== '+';
  if (!action || shifted) return { type: 'shinsa' };
  if (action.type === 'copy' && !hasSelection) return { type: 'nothing' };
  return action;
}

function resolveMacOption(event: KeyPress): TerminalKey {
  const sends = OPTION_SENDS[event.key];
  if (sends && !event.shiftKey) return { type: 'send', data: sends };
  if (event.key === 'Enter') return NEWLINE;
  if (isPrintableAscii(event.key)) return { type: 'send', data: event.key };
  return { type: 'shell' };
}

function resolveMacKey(event: KeyPress, hasSelection: boolean): TerminalKey {
  if (event.metaKey) return resolveMacCommand(event, hasSelection);
  if (event.altKey && !event.ctrlKey) return resolveMacOption(event);
  if (event.key === 'Enter' && event.shiftKey && !event.ctrlKey) return NEWLINE;
  return { type: 'shell' };
}

function resolveOtherKey(event: KeyPress, hasSelection: boolean): TerminalKey {
  if (event.key === 'Enter' && (event.shiftKey || event.altKey) && !event.ctrlKey) return NEWLINE;
  if (!(event.ctrlKey && event.shiftKey) || event.altKey || event.metaKey) return { type: 'shell' };
  const action = CONTROL_SHIFT_KEYS[event.key.toLowerCase()];
  if (action?.type === 'copy' && !hasSelection) return { type: 'nothing' };
  return action ?? { type: 'shell' };
}

export function resolveTerminalKey(event: KeyPress, mac: boolean, hasSelection: boolean): TerminalKey {
  return mac ? resolveMacKey(event, hasSelection) : resolveOtherKey(event, hasSelection);
}

export function describeFindKey(mac: boolean) {
  return mac ? '⌘F' : 'Ctrl+Shift+F';
}

export function describeClearKey(mac: boolean) {
  return mac ? '⌘L' : 'Ctrl+Shift+L';
}

export type TerminalPageKey = 'new' | 'close';

export function resolveTerminalPageKey(event: KeyPress, mac: boolean): TerminalPageKey | null {
  if (!mac || !event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return null;
  const key = event.key.toLowerCase();
  if (key === 't') return 'new';
  if (key === 'w') return 'close';
  return null;
}
