import type { RunRole, ShinsaState } from '@shinsa/core';
import { type Effect, Schema } from 'effect';
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

export interface IdleCompactionOptions {
  now?: () => number;
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

export interface IdleCompactionDefinition {
  readonly state: Effect.Effect<ShinsaState>;
  readonly now: Effect.Effect<number>;
  readonly compact: (runId: string, sessionId: string) => Effect.Effect<void, CompactionFailed>;
}

export interface IdleCompactionHandle {
  readonly record: (runId: string, context: SessionContext | null) => Effect.Effect<void>;
  readonly schedule: (taskId: string) => Effect.Effect<void>;
  readonly cancel: (taskId: string) => Effect.Effect<void>;
  readonly settle: (taskId: string) => Effect.Effect<void>;
  readonly stop: Effect.Effect<void>;
}
