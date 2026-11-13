import type { AutoRetry } from '@shinsa/core';

export function resolveRetryCommandId(taskId: string, retry: Pick<AutoRetry, 'attempt' | 'at'>) {
  return `auto-retry:${taskId}:${retry.attempt}:${retry.at}`;
}
