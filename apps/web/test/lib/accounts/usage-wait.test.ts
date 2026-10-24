import { describe, expect, it } from 'bun:test';
import type { UsageWait } from '@shinsa/core';
import {
  describeUsageWaitBody,
  describeUsageWaitNote,
  describeUsageWaitTitle,
  describeUsageWaitToggle,
  describeUsageWaitToggled,
  isUsageWaitArmed,
} from '@/lib/accounts/usage-wait.ts';
import { createTask, NOW } from '../../support/state.ts';

function wait(overrides: Partial<UsageWait> = {}): UsageWait {
  return {
    id: 'w1',
    runId: 'r1',
    role: 'builder',
    phaseIndex: 0,
    account: { id: 'a', email: 'a@example.com' },
    resetAt: NOW + 3_600_000,
    armedAt: NOW,
    autoResume: true,
    status: 'armed',
    ...overrides,
  };
}

describe('usage waits', () => {
  it('waits only while the wait is armed', () => {
    expect(isUsageWaitArmed(createTask({ id: 't', usageWait: wait() }))).toBe(true);
    expect(isUsageWaitArmed(createTask({ id: 't', usageWait: wait({ status: 'resumed' }) }))).toBe(false);
    expect(isUsageWaitArmed(createTask({ id: 't' }))).toBe(false);
  });

  it('says whether the task resumes by itself or waits for you', () => {
    expect(describeUsageWaitTitle(wait())).toBe('Resumes when the usage limit resets');
    expect(describeUsageWaitTitle(wait({ autoResume: false }))).toBe('Paused until the usage limit resets');
    expect(describeUsageWaitBody(wait())).toBe(
      'The agent stopped at the Claude usage limit on a@example.com.'
    );
    expect(describeUsageWaitBody(wait({ account: null }))).toBe(
      'The agent stopped at the Claude usage limit.'
    );
    expect(describeUsageWaitBody(wait({ account: null, provider: 'codex' }))).toBe(
      'The agent stopped at the Codex usage limit.'
    );
    expect(describeUsageWaitNote(wait())).toBe('Shinsa resumes it by itself when the limit resets.');
    expect(describeUsageWaitNote(wait({ autoResume: false }))).toBe(
      'When the limit resets it pauses for you to retry.'
    );
    expect(describeUsageWaitToggle(wait())).toBe('Don’t resume automatically');
    expect(describeUsageWaitToggle(wait({ autoResume: false }))).toBe('Resume at the reset');
    expect(describeUsageWaitToggled(true)).toBe('Resumes at the reset.');
    expect(describeUsageWaitToggled(false)).toBe('Waits for you at the reset.');
  });
});
