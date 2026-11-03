import type { CompactionMode } from '@shinsa/core';
import { Effect } from 'effect';
import { edgeRuntime } from '../../../runtime/edge.ts';
import type { ClaudeRoute, EunoeLink } from './route/schema.ts';
import { resolveRoute } from './route/service.ts';

export {
  BLOCKING_LIMIT_ENV,
  DIRECT_BASE_URL,
  type EunoeLink,
  type EunoeStatus,
  type EunoeWatcher,
} from './route/schema.ts';

export function resolveClaudeRoute(
  compaction: CompactionMode,
  eunoe: EunoeLink | null
): Promise<ClaudeRoute> {
  return edgeRuntime.runPromise(
    resolveRoute(compaction, eunoe ? Effect.promise(() => eunoe.ensure()) : null)
  );
}
