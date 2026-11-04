import type { RunRole } from '@shinsa/core';
import { Context, type Effect, Schema } from 'effect';
import type { SessionContext } from '../providers/index.ts';

export const COMPACTION_NEAR_LIMIT = 0.8;

export const RESUMED_ROLES: ReadonlySet<RunRole> = new Set<RunRole>([
  'agent',
  'answerer',
  'investigator',
  'researcher',
]);

export interface CompactionWindow {
  readonly runId: string;
  readonly sessionId: string;
  readonly startAt: number;
}

export interface LastSession {
  readonly runId: string;
  readonly context: SessionContext | null;
}

export interface PendingCompaction {
  readonly runId: string;
  readonly context: SessionContext;
}

export class CompactionFailed extends Schema.TaggedError<
  CompactionFailed,
  { readonly brand: unique symbol }
>()('CompactionFailed', { message: Schema.String }) {}

export class IdleCompactor extends Context.Service<
  IdleCompactor,
  (runId: string, sessionId: string) => Effect.Effect<void, CompactionFailed>
>()('shinsa/engine/agents/compaction/IdleCompactor') {}
