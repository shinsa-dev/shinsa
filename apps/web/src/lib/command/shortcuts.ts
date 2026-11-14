import { isTyping } from '@/lib/keys.ts';
import { resolveTerminalEntry } from '@/lib/terminal/tabs.ts';

export type AppShortcutTarget = 'home' | 'tasks' | 'settings' | 'terminal';

export type AppShortcutKeys =
  | { kind: 'modifier'; key: string }
  | { kind: 'chord'; first: string; then: string };

export interface AppShortcut {
  target: AppShortcutTarget;
  keys: AppShortcutKeys;
}

export interface AppKeyPress {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
  repeat: boolean;
  timeStamp: number;
  target: EventTarget | null;
}

export interface PendingChord {
  first: string;
  at: number;
}

export type AppShortcutResult =
  | { kind: 'go'; target: AppShortcutTarget }
  | { kind: 'pending'; chord: PendingChord }
  | { kind: 'none' };

export const CHORD_WINDOW_MS = 1500;

export const APP_SHORTCUTS: readonly AppShortcut[] = [
  { target: 'terminal', keys: { kind: 'modifier', key: 'j' } },
  { target: 'settings', keys: { kind: 'modifier', key: ',' } },
  { target: 'home', keys: { kind: 'chord', first: 'g', then: 'h' } },
  { target: 'tasks', keys: { kind: 'chord', first: 'g', then: 't' } },
  { target: 'settings', keys: { kind: 'chord', first: 'g', then: 's' } },
];

const NONE: AppShortcutResult = { kind: 'none' };

function resolveModifierKey(event: AppKeyPress, mac: boolean): AppShortcutResult {
  const modifier = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!modifier || event.altKey || event.shiftKey) return NONE;
  const key = event.key.toLowerCase();
  const shortcut = APP_SHORTCUTS.find((entry) => entry.keys.kind === 'modifier' && entry.keys.key === key);
  return shortcut ? { kind: 'go', target: shortcut.target } : NONE;
}

function resolveChordKey(event: AppKeyPress, pending: PendingChord | null): AppShortcutResult {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || isTyping(event.target)) return NONE;
  const key = event.key.toLowerCase();
  const live = pending && event.timeStamp - pending.at <= CHORD_WINDOW_MS ? pending : null;
  if (live) {
    const shortcut = APP_SHORTCUTS.find(
      (entry) => entry.keys.kind === 'chord' && entry.keys.first === live.first && entry.keys.then === key
    );
    if (shortcut) return { kind: 'go', target: shortcut.target };
  }
  const starts = APP_SHORTCUTS.some((entry) => entry.keys.kind === 'chord' && entry.keys.first === key);
  return starts ? { kind: 'pending', chord: { first: key, at: event.timeStamp } } : NONE;
}

export function resolveAppShortcut(
  event: AppKeyPress,
  pending: PendingChord | null,
  mac: boolean
): AppShortcutResult {
  if (event.defaultPrevented || event.repeat) return NONE;
  const modified = resolveModifierKey(event, mac);
  if (modified.kind !== 'none') return modified;
  return resolveChordKey(event, pending);
}

function describeKey(key: string) {
  return key.length === 1 ? key.toUpperCase() : key;
}

export function describeShortcut(target: AppShortcutTarget, mac: boolean) {
  const shortcut = APP_SHORTCUTS.find((entry) => entry.target === target);
  if (!shortcut) return '';
  const { keys } = shortcut;
  if (keys.kind === 'chord') return `${describeKey(keys.first)} ${describeKey(keys.then)}`;
  return mac ? `⌘${describeKey(keys.key)}` : `Ctrl+${describeKey(keys.key)}`;
}

const TARGET_PATHS: Record<Exclude<AppShortcutTarget, 'terminal'>, string> = {
  home: '/',
  tasks: '/tasks',
  settings: '/settings',
};

export function resolveShortcutPath(target: AppShortcutTarget) {
  return target === 'terminal' ? resolveTerminalEntry() : TARGET_PATHS[target];
}
