import { describe, expect, it } from 'bun:test';
import type { AutoRetry } from '@shinsa/core';
import { describeRetryCount, describeRetryCountdown } from '@/lib/overview/retry.ts';

const MINUTE = 60_000;

const RETRY: AutoRetry = {
  at: 5 * MINUTE,
  attempt: 2,
  title: 'The agent paused',
  detail: 'it ended its turn without calling the hand-over tool',
  runId: null,
  cause: null,
  milestone: 'm',
  status: 'armed',
};

describe('the automatic retry', () => {
  it('counts down to the retry, and says it retries now once it is due', () => {
    expect(describeRetryCountdown(RETRY, 0)).toBe('Retries in 5m');
    expect(describeRetryCountdown(RETRY, 5 * MINUTE)).toBe('Retrying now');
  });

  it('names which of the ten retries this is', () => {
    expect(describeRetryCount(RETRY)).toBe('Retry 2 of 10');
  });
});
