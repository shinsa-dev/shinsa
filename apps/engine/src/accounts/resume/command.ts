import type { UsageWait } from '@shinsa/core';

export function resolveResumeCommandId(taskId: string, wait: UsageWait) {
  return `usage-resume:${taskId}:${wait.runId}:${wait.resetAt}:${wait.id}`;
}
