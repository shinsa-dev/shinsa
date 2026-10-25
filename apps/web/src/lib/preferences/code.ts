import { useSyncExternalStore } from 'react';
import { usePaneWidth } from '@/lib/preferences/pane-width.ts';
import { useStoredToggle } from '@/lib/preferences/stored-flag.ts';
import { createSignal } from '@/lib/signal.ts';

const EXPLORER_WIDTH = { min: 200, max: 480, initial: 280 } as const;

const VIEWED_PREFIX = 'shinsa.viewed.';

const viewed = createSignal();

export function useExplorerWidth(floor = 0) {
  return usePaneWidth('shinsa.code-explorer-width', EXPLORER_WIDTH, floor);
}

export function useUnifiedDiff() {
  return useStoredToggle('shinsa.code-unified', false);
}

export function useHideViewed() {
  return useStoredToggle('shinsa.code-hide-viewed', false);
}

function resolveViewedKey(taskId: string, head: string) {
  return `${VIEWED_PREFIX}${taskId}.${head}`;
}

export function readViewedFiles(taskId: string, head: string): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(resolveViewedKey(taskId, head)) ?? '[]');
    return Array.isArray(stored) ? stored.filter((path): path is string => typeof path === 'string') : [];
  } catch {
    return [];
  }
}

export function toggleViewedFile(taskId: string, head: string, path: string) {
  const current = readViewedFiles(taskId, head);
  const next = current.includes(path) ? current.filter((known) => known !== path) : [...current, path];
  localStorage.setItem(resolveViewedKey(taskId, head), JSON.stringify(next));
  viewed.publish();
}

export function useViewedFiles(taskId: string, head: string | null) {
  const serialized = useSyncExternalStore(viewed.subscribe, () =>
    head ? (localStorage.getItem(resolveViewedKey(taskId, head)) ?? '') : ''
  );
  return new Set(serialized && head ? readViewedFiles(taskId, head) : []);
}
