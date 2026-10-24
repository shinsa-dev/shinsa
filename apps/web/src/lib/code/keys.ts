export type CodeKey = 'quick-open' | 'search' | 'find' | 'goto-line';

interface KeyPress {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
}

const KEYS: Record<CodeKey, { key: string; shift: boolean }> = {
  'quick-open': { key: 'p', shift: false },
  search: { key: 'f', shift: true },
  find: { key: 'f', shift: false },
  'goto-line': { key: 'g', shift: false },
};

export function isMacPlatform(platform: string) {
  return /Mac|iPhone|iPad|iPod/.test(platform);
}

export function resolveCodeKey(event: KeyPress, mac: boolean): CodeKey | null {
  const modifier = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!modifier || event.altKey || event.defaultPrevented) return null;
  const key = event.key.toLowerCase();
  for (const [name, binding] of Object.entries(KEYS) as [CodeKey, (typeof KEYS)[CodeKey]][]) {
    if (binding.key === key && binding.shift === event.shiftKey) return name;
  }
  return null;
}

export function describeCodeKey(name: CodeKey, mac: boolean) {
  const binding = KEYS[name];
  const letter = binding.key.toUpperCase();
  if (mac) return `${binding.shift ? '⇧' : ''}⌘${letter}`;
  return `Ctrl+${binding.shift ? 'Shift+' : ''}${letter}`;
}
