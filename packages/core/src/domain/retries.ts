import { MINUTE_MS } from './time.ts';
import type { Task } from './types.ts';

export const MAX_AUTO_RETRIES = 10;

const AUTO_RETRY_DELAYS_MS = [1, 5, 15, 30, 60].map((minutes) => minutes * MINUTE_MS);

export function resolveAutoRetryDelay(attempt: number) {
  return AUTO_RETRY_DELAYS_MS[Math.min(attempt, AUTO_RETRY_DELAYS_MS.length) - 1] ?? MINUTE_MS;
}

export function describeRetriesSpent(detail: string) {
  return `${detail} Shinsa already retried it ${MAX_AUTO_RETRIES} times on its own.`;
}

export function isRetryArmed(task: Pick<Task, 'autoRetry'>) {
  return task.autoRetry?.status === 'armed';
}
