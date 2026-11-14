import { useSyncExternalStore } from 'react';
import { listStoredStrings } from '@/lib/preferences/stored-list.ts';
import { createSignal } from '@/lib/signal.ts';

const RECENT_PREFIX = 'shinsa.code-recent.';

export const RECENT_FILE_LIMIT = 10;

const recent = createSignal();

function resolveRecentKey(taskId: string) {
  return `${RECENT_PREFIX}${taskId}`;
}

export function listRecentFiles(taskId: string): string[] {
  return listStoredStrings(resolveRecentKey(taskId));
}

export function recordRecentFile(taskId: string, path: string) {
  const current = listRecentFiles(taskId);
  if (current[0] === path) return;
  const next = [path, ...current.filter((known) => known !== path)].slice(0, RECENT_FILE_LIMIT);
  localStorage.setItem(resolveRecentKey(taskId), JSON.stringify(next));
  recent.publish();
}

export function resolveQuickOpenRecent(files: readonly string[], activePath: string | null) {
  return files.filter((path) => path !== activePath);
}

export function splitRecentRows<Row extends { path: string }>(
  ranked: readonly Row[],
  recentPaths: readonly string[],
  query: string
) {
  const recentRows = query.trim() ? [] : ranked.filter((row) => recentPaths.includes(row.path));
  const otherRows = recentRows.length > 0 ? ranked.filter((row) => !recentPaths.includes(row.path)) : ranked;
  return { recentRows, otherRows };
}

export function useRecentFiles(taskId: string) {
  const serialized = useSyncExternalStore(
    recent.subscribe,
    () => localStorage.getItem(resolveRecentKey(taskId)) ?? ''
  );
  return serialized ? listRecentFiles(taskId) : [];
}
