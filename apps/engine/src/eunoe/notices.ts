import type { ChatNotice } from '@shinsa/core';
import type { RequestEntry } from './schema.ts';

export function resolveCompactionNotice(entry: RequestEntry): ChatNotice | null {
  if (entry.compacted !== true) return null;
  const actions = Array.isArray(entry.actions) ? entry.actions : [];
  return {
    kind: 'compaction',
    trigger: actions.includes('cut') ? 'auto' : 'fold',
    preTokens: null,
    summary: null,
    by: 'eunoe',
  };
}

export function isStuck(entry: RequestEntry) {
  return typeof entry.stuck === 'object' && entry.stuck !== null && entry.fit === 'over';
}
