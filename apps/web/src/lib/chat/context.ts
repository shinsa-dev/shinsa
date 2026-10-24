import type { ChatEntry, ChatEntryOf, ChatNotice } from '@shinsa/core';
import { resolveUsageTone } from '@/lib/accounts/usage.ts';
import { formatTokenCount, formatTokens } from '@/lib/format/money.ts';
import type { Tone } from '@/lib/format/tone.ts';

type ContextNotice = Extract<ChatNotice, { kind: 'context' }>;

export interface ContextMeterView {
  percent: number;
  tone: Tone;
  label: string;
  tokens: string;
}

function isSessionNotice(entry: ChatEntry): entry is ChatEntryOf<'notice'> {
  return entry.type === 'notice' && (entry.notice.kind === 'context' || entry.notice.kind === 'handoff');
}

export function selectContextNotice(transcripts: readonly (readonly ChatEntry[])[]): ContextNotice | null {
  for (const entries of [...transcripts].reverse()) {
    const notice = entries.filter(isSessionNotice).at(-1)?.notice;
    if (notice) return notice.kind === 'context' ? notice : null;
  }
  return null;
}

export function resolveContextMeter(notice: ContextNotice | null): ContextMeterView | null {
  if (!notice || notice.maxTokens === null || notice.maxTokens <= 0) return null;
  const percent = Math.round(Math.min(100, Math.max(0, (notice.usedTokens / notice.maxTokens) * 100)));
  return {
    percent,
    tone: resolveUsageTone(percent),
    label: `Context ${percent}% full`,
    tokens: `${formatTokenCount(notice.usedTokens)} of ${formatTokens(notice.maxTokens)}`,
  };
}
