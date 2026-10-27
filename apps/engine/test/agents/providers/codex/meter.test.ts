import { describe, expect, test } from 'bun:test';
import type { RunUsage } from '@shinsa/core';
import { CodexMeter } from '../../../../src/agents/providers/codex/meter.ts';

function breakdown(input: number, output: number, cached = 0, written = 0) {
  return {
    totalTokens: input + output,
    inputTokens: input,
    cachedInputTokens: cached,
    cacheWriteInputTokens: written,
    outputTokens: output,
    reasoningOutputTokens: 0,
  };
}

function tokenUsage(total: ReturnType<typeof breakdown>, lastInput = total.inputTokens) {
  return { total, last: { ...total, inputTokens: lastInput }, modelContextWindow: 400_000 };
}

describe('metering a Codex thread', () => {
  test('counts tokens and prices what each update added', () => {
    const meter = new CodexMeter();
    meter.record('t1', tokenUsage(breakdown(1_000_000, 0), 1_000), 'gpt-6-astra', false);
    meter.record('t1', tokenUsage(breakdown(1_000_000, 0), 1_000), 'gpt-6-astra', false);
    meter.record('t1', tokenUsage(breakdown(1_000_000, 1_000_000, 0), 1_000), 'gpt-6-astra', false);
    expect(meter.usage('t1')).toEqual({
      inputTokens: 1_000_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 1_000_000,
      costUsd: 60,
    });
  });

  test('cached and written input tokens are their own kinds', () => {
    const meter = new CodexMeter();
    meter.record('t1', tokenUsage(breakdown(1_000, 10, 600, 100)), 'gpt-6-astra', false);
    expect(meter.usage('t1')).toMatchObject({
      inputTokens: 300,
      cacheReadTokens: 600,
      cacheWriteTokens: 100,
    });
  });

  test('a request past 272K input tokens is charged the long-context rate', () => {
    const meter = new CodexMeter();
    meter.record('t1', tokenUsage(breakdown(300_000, 0), 300_000), 'gpt-6-astra', false);
    expect(meter.usage('t1')?.costUsd).toBeCloseTo(6);
  });

  test('a resumed thread starts from what Shinsa already metered, so history is not counted twice', () => {
    const recorded: RunUsage = {
      inputTokens: 1_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      costUsd: 0.5,
    };
    const meter = new CodexMeter((sessionId) => (sessionId === 't1' ? recorded : null));
    meter.record('t1', tokenUsage(breakdown(1_000, 0)), 'gpt-6-astra', false);
    expect(meter.usage('t1')).toEqual(recorded);
    meter.record('t1', tokenUsage(breakdown(101_000, 0)), 'gpt-6-astra', false);
    expect(meter.usage('t1')).toMatchObject({ inputTokens: 101_000, costUsd: 1.5 });
  });

  test('a session whose earlier cost is unknown stays unknown', () => {
    const recorded: RunUsage = {
      inputTokens: 10,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      costUsd: null,
    };
    const meter = new CodexMeter(() => recorded);
    meter.record('t1', tokenUsage(breakdown(110, 0)), 'gpt-6-astra', false);
    expect(meter.usage('t1')).toMatchObject({ inputTokens: 110, costUsd: null });
  });

  test('an unknown model leaves the cost unknown for the rest of the thread', () => {
    const meter = new CodexMeter();
    meter.record('t1', tokenUsage(breakdown(100, 0)), 'gpt-9-nova', false);
    meter.record('t1', tokenUsage(breakdown(200, 0)), 'gpt-6-astra', false);
    expect(meter.usage('t1')).toMatchObject({ inputTokens: 200, costUsd: null });
  });

  test('counters that go back are a new start, never a negative charge', () => {
    const meter = new CodexMeter();
    meter.record('t1', tokenUsage(breakdown(500, 0)), 'gpt-6-astra', false);
    meter.record('t1', tokenUsage(breakdown(100, 0)), 'gpt-6-astra', false);
    meter.record('t1', tokenUsage(breakdown(150, 0)), 'gpt-6-astra', false);
    expect(meter.usage('t1')?.inputTokens).toBe(550);
  });

  test('other threads are listed apart, and an update without totals or tokens is ignored', () => {
    const meter = new CodexMeter();
    meter.record('main', tokenUsage(breakdown(100, 0)), 'gpt-6-astra', false);
    meter.record('agent', tokenUsage(breakdown(50, 5)), 'gpt-5.6-luna', true);
    meter.record('agent', { last: {} }, 'gpt-5.6-luna', true);
    meter.record('empty', tokenUsage(breakdown(0, 0)), 'gpt-5.6-luna', false);
    expect(meter.listOthers('main')).toEqual([
      { sessionId: 'agent', usage: expect.objectContaining({ inputTokens: 50, outputTokens: 5 }) },
    ]);
    expect(meter.listOthers(null).map((thread) => thread.sessionId)).toEqual(['main', 'agent']);
    expect(meter.usage('unknown')).toBeNull();
  });
});
