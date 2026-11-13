import { listStoredStrings } from '@/lib/preferences/stored-list.ts';

const STORAGE_KEY = 'shinsa.recent-tasks';

const LIMIT = 8;

export function listRecentTaskIds(): string[] {
  return listStoredStrings(STORAGE_KEY);
}

export function recordRecentTask(taskId: string) {
  const next = [taskId, ...listRecentTaskIds().filter((entry) => entry !== taskId)].slice(0, LIMIT);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}
