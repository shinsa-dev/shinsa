import { describe, expect, it } from 'bun:test';
import type { ChatEvent, ChatTool, Monitor } from '@shinsa/core';
import {
  describeCheckInCount,
  describeGiveUp,
  describeNextCheckIn,
  describeSilence,
  STALLED_REASON,
  selectRunningTool,
} from '@/lib/overview/wait.ts';
import { createEntry } from '../../support/server.ts';

const MINUTE = 60_000;

function entry(event: ChatEvent) {
  return createEntry(event, crypto.randomUUID(), 0);
}

const MONITOR: Monitor = {
  id: 'm',
  runId: 'r',
  role: 'agent',
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
  it('names the next check-in, the count and when it gives up', () => {
    expect(describeNextCheckIn(MONITOR, 0)).toBe('Checks in again in 12m');
    expect(describeNextCheckIn(MONITOR, 12 * MINUTE)).toBe('Checks in again in under a minute');
    expect(describeCheckInCount(MONITOR)).toBe('Check-in 2 of 10');
    expect(describeGiveUp(MONITOR, 0)).toBe('gives up in 2h');
    expect(describeGiveUp(MONITOR, 120 * MINUTE)).toBe('gives up at the next check-in');
  });

  it('a quiet run reads as how long it has been quiet, only once it counts', () => {
    expect(describeSilence('suspicious', 0, 7 * MINUTE)).toBe('No output for 7 minutes');
    expect(describeSilence('critical', 0, 20 * MINUTE)).toBe('No output for 20 minutes');
    expect(describeSilence('critical', 0, 0)).toBe('No output for 5 minutes');
    expect(describeSilence('ok', 0, MINUTE)).toBeNull();
    expect(describeSilence('snoozed', 0, MINUTE)).toBeNull();
  });

  it('a quiet run with a tool still running says so, naming the command', () => {
    expect(describeSilence('suspicious', 0, 7 * MINUTE, { command: 'bun test src/a' })).toBe(
      'A command has been running for 7 minutes'
    );
    expect(describeSilence('critical', 0, 20 * MINUTE, { command: null })).toBe(
      'A tool has been running for 20 minutes'
    );
    expect(describeSilence('ok', 0, MINUTE, { command: null })).toBeNull();
  });

  it('the running tool is the newest call without a result', () => {
    const command = { kind: 'command', action: 'run', command: 'bun test src/a', description: null } as const;
    const read = { kind: 'read', path: 'src/a.ts', range: null } as const;
    const call = (callId: string, tool: ChatTool) => entry({ type: 'tool_call', callId, tool });
    const result = (callId: string) =>
      entry({ type: 'tool_result', callId, status: 'ok', output: '', images: [] });
    expect(selectRunningTool([])).toBeNull();
    expect(selectRunningTool([call('a', read), result('a')])).toBeNull();
    expect(selectRunningTool([call('a', read), call('b', command)])).toEqual({ command: 'bun test src/a' });
    expect(selectRunningTool([call('b', command), call('a', read)])).toEqual({ command: null });
    expect(selectRunningTool([call('b', command), call('a', read), result('a')])).toEqual({
      command: 'bun test src/a',
    });
    expect(selectRunningTool([call('b', { ...command, action: 'output' })])).toEqual({ command: null });
    expect(selectRunningTool([entry({ type: 'agent', phase: 'interim', text: 'Hi' })])).toBeNull();
  });

  it('says why a task up the chain holds it up', () => {
    expect(STALLED_REASON).toEqual({
      needs_you: 'is waiting on you',
      paused: 'is paused',
      cancelled: 'was cancelled',
    });
  });
});
