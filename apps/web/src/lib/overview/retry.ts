import { type AutoRetry, MAX_AUTO_RETRIES } from '@shinsa/core';
import { formatUntil } from '@/lib/format/time.ts';

export const RETRY_NOTE = 'A message in the chat retries it now with your guidance.';

export function describeRetryCountdown(retry: AutoRetry, now: number) {
  return retry.at <= now ? 'Retrying now' : formatUntil('Retries', retry.at, now);
}

export function describeRetryCount(retry: AutoRetry) {
  return `Retry ${retry.attempt} of ${MAX_AUTO_RETRIES}`;
}
