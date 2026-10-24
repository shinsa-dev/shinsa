import { describe, expect, it } from 'bun:test';
import type { ChatEntryOf } from '@shinsa/core';
import { resolveContextMeter, selectContextNotice } from '@/lib/chat/context.ts';
import { createAgentEntry, createNoticeEntry } from '../../support/chat.ts';

type Notice = ChatEntryOf<'notice'>['notice'];

const HANDOFF: Notice = {
  kind: 'handoff',
  reason: 'provider_switch',
  fromProvider: 'Claude',
  toProvider: 'Codex',
  totalEntries: 40,
  includedEntries: 40,
};

function context(
  usedTokens: number,
  maxTokens: number | null = 200_000
): Extract<Notice, { kind: 'context' }> {
  return { kind: 'context', usedTokens, maxTokens, totalProcessedTokens: null };
}

describe('the context meter', () => {
  it('reads the latest context the newest run reported', () => {
    const notice = selectContextNotice([
      [createNoticeEntry(context(10_000), 1)],
      [
        createNoticeEntry(context(40_000), 2),
        createAgentEntry('done', 'final', 3),
        createNoticeEntry(context(84_000), 4),
      ],
    ]);
    expect(notice).toEqual(context(84_000));
  });

  it('falls back to an earlier run when the newest has not reported yet', () => {
    expect(
      selectContextNotice([
        [createNoticeEntry(context(10_000), 1)],
        [createAgentEntry('working', 'interim', 2)],
      ])
    ).toEqual(context(10_000));
  });

  it('shows nothing after a hand-over until the new session reports', () => {
    expect(
      selectContextNotice([[createNoticeEntry(context(150_000), 1), createNoticeEntry(HANDOFF, 2)]])
    ).toBeNull();
    expect(
      selectContextNotice([[createNoticeEntry(context(150_000), 1)], [createNoticeEntry(HANDOFF, 2)]])
    ).toBeNull();
    expect(
      selectContextNotice([[createNoticeEntry(HANDOFF, 1), createNoticeEntry(context(12_000), 2)]])
    ).toEqual(context(12_000));
  });

  it('shows nothing without any context reported', () => {
    expect(selectContextNotice([])).toBeNull();
    expect(selectContextNotice([[createAgentEntry('hi', 'final', 1)]])).toBeNull();
    expect(resolveContextMeter(null)).toBeNull();
  });

  it('shows nothing when the window size is unknown', () => {
    expect(
      resolveContextMeter({ kind: 'context', usedTokens: 5_000, maxTokens: null, totalProcessedTokens: null })
    ).toBeNull();
    expect(
      resolveContextMeter({ kind: 'context', usedTokens: 5_000, maxTokens: 0, totalProcessedTokens: null })
    ).toBeNull();
  });

  it('gives the share of the window in the usage tones, with the token counts', () => {
    expect(
      resolveContextMeter({
        kind: 'context',
        usedTokens: 84_000,
        maxTokens: 200_000,
        totalProcessedTokens: null,
      })
    ).toEqual({
      percent: 42,
      tone: 'neutral',
      label: 'Context 42% full',
      tokens: '84k of 200k tokens',
    });
    expect(
      resolveContextMeter({
        kind: 'context',
        usedTokens: 150_000,
        maxTokens: 200_000,
        totalProcessedTokens: null,
      })?.tone
    ).toBe('amber');
    expect(
      resolveContextMeter({
        kind: 'context',
        usedTokens: 180_000,
        maxTokens: 200_000,
        totalProcessedTokens: null,
      })?.tone
    ).toBe('red');
    expect(
      resolveContextMeter({
        kind: 'context',
        usedTokens: 260_000,
        maxTokens: 200_000,
        totalProcessedTokens: null,
      })?.percent
    ).toBe(100);
  });
});
