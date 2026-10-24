const HOUR = 60 * 60 * 1000;

const FIVE_MINUTES = 5 * 60 * 1000;

export const COMPACT_PROMPT = '/compact';

function readCount(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function resolveCacheExpiry(usage: unknown, at: number): number | null {
  if (!usage || typeof usage !== 'object') return null;
  const creation = (usage as Record<string, unknown>).cache_creation;
  if (!creation || typeof creation !== 'object') return null;
  const record = creation as Record<string, unknown>;
  if (readCount(record.ephemeral_1h_input_tokens) > 0) return at + HOUR;
  if (readCount(record.ephemeral_5m_input_tokens) > 0) return at + FIVE_MINUTES;
  return null;
}

interface BackgroundTask {
  task_id: string;
  ambient?: boolean;
}

export function listBackgroundWork(tasks: readonly BackgroundTask[]) {
  return new Set(tasks.filter((task) => task.ambient !== true).map((task) => task.task_id));
}
