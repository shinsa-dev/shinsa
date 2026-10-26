export type TerminalKey = 'shinsa' | 'shell' | 'copy' | 'paste' | 'find' | 'select-all';

interface KeyPress {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

const KEYS: Record<string, TerminalKey> = { c: 'copy', v: 'paste', f: 'find', a: 'select-all' };

export function resolveTerminalKey(event: KeyPress, mac: boolean, hasSelection: boolean): TerminalKey {
  const key = event.key.toLowerCase();
  if (mac) {
    if (!event.metaKey) return 'shell';
    if (event.ctrlKey || event.altKey) return 'shinsa';
    const action = event.shiftKey ? undefined : KEYS[key];
    if (action === 'copy' && !hasSelection) return 'shinsa';
    return action ?? 'shinsa';
  }
  if (!(event.ctrlKey && event.shiftKey) || event.altKey || event.metaKey) return 'shell';
  return KEYS[key] ?? 'shell';
}

export function describeFindKey(mac: boolean) {
  return mac ? '⌘F' : 'Ctrl+Shift+F';
}
