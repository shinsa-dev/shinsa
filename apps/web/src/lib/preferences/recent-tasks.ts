const STORAGE_KEY = 'shinsa.recent-tasks';

const LIMIT = 8;

export function listRecentTaskIds(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

export function recordRecentTask(taskId: string) {
  const next = [taskId, ...listRecentTaskIds().filter((entry) => entry !== taskId)].slice(0, LIMIT);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}
