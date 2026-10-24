import { describe, expect, it } from 'bun:test';
import type { Monitor } from '@shinsa/core';
import {
  describeCheckCount,
  describeGiveUp,
  describeNextCheck,
  describeSilence,
  STALLED_REASON,
} from '@/lib/overview/wait.ts';

const MINUTE = 60_000;

const MONITOR: Monitor = {
  id: 'm',
  runId: 'r',
  role: 'builder',
  phaseIndex: 0,
  notes: 'The deploy.',
  armedAt: 0,
  nextCheckAt: 12 * MINUTE,
  timeoutAt: 120 * MINUTE,
  attempts: 1,
  maxAttempts: 10,
  status: 'armed',
};

describe('the wait', () => {
  it('names the next check, the count and when it gives up', () => {
    expect(describeNextCheck(MONITOR, 0)).toBe('Checks again in 12m');
    expect(describeNextCheck(MONITOR, 12 * MINUTE)).toBe('Checks again in under a minute');
    expect(describeCheckCount(MONITOR)).toBe('Check 2 of 10');
    expect(describeGiveUp(MONITOR, 0)).toBe('gives up in 2h');
    expect(describeGiveUp(MONITOR, 120 * MINUTE)).toBe('gives up at the next check');
  });

  it('a quiet run reads as how long it has been quiet, only once it counts', () => {
    expect(describeSilence('suspicious', 0, 7 * MINUTE)).toBe('No output for 7 minutes');
    expect(describeSilence('critical', 0, 20 * MINUTE)).toBe('No output for 20 minutes');
    expect(describeSilence('critical', 0, 0)).toBe('No output for 5 minutes');
    expect(describeSilence('ok', 0, MINUTE)).toBeNull();
    expect(describeSilence('snoozed', 0, MINUTE)).toBeNull();
  });

  it('says why a task up the chain holds it up', () => {
    expect(STALLED_REASON).toEqual({
      needs_you: 'is waiting on you',
      paused: 'is paused',
      cancelled: 'was cancelled',
    });
  });
});
