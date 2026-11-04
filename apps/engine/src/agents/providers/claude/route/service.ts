import { type ChatNotice, type CompactionMode, isEunoeCompaction } from '@shinsa/core';
import { Effect } from 'effect';
import {
  BLOCKING_LIMIT_ENV,
  BLOCKING_LIMIT_OFF,
  type ClaudeRoute,
  DIRECT_BASE_URL,
  EUNOE_MISSING,
  type EunoeStatus,
} from './schema.ts';

export const resolveRoute = Effect.fn('ClaudeRoute.resolve')(function* (
  compaction: CompactionMode,
  ensure: Effect.Effect<EunoeStatus> | null
) {
  const resolveDirect = (autoCompact: boolean, notice: ChatNotice | null = null): ClaudeRoute => ({
    env: { ANTHROPIC_BASE_URL: DIRECT_BASE_URL, [BLOCKING_LIMIT_ENV]: '' },
    autoCompact,
    eunoe: false,
    notice,
  });

  if (!isEunoeCompaction(compaction)) return resolveDirect(compaction === 'provider');
  const status: EunoeStatus = ensure ? yield* ensure : { ok: false, reason: EUNOE_MISSING };
  if (!status.ok) {
    return resolveDirect(true, {
      kind: 'proxy',
      proxy: 'eunoe',
      status: 'unavailable',
      detail: status.reason,
    });
  }
  return {
    env: { ANTHROPIC_BASE_URL: status.url, [BLOCKING_LIMIT_ENV]: BLOCKING_LIMIT_OFF, EUNOE_DIR: status.dir },
    autoCompact: false,
    eunoe: true,
    notice: null,
  } satisfies ClaudeRoute;
});
