import type {
  Briefing,
  GuestActor,
  ShinsaCommand,
  ShinsaEffect,
  ShinsaState,
  StateChanges,
} from '@shinsa/core';
import { Duration, Schema } from 'effect';
import type { Effect } from 'effect';
import type { EffectFailure } from '../failures/schema.ts';

export interface StateChange {
  previous: ShinsaState;
  changes: StateChanges;
}

export interface StateUpdate extends StateChange {
  state: ShinsaState;
}

export type StateListener = (state: ShinsaState, change: StateChange) => void;

export interface EffectAttempt {
  key: string;
  attempt: number;
}

export interface EffectContext extends EffectAttempt {
  signal: AbortSignal;
}

export interface EffectRetry {
  attempt: number;
  attempts: number;
  retryAt: number;
  failure: EffectFailure;
}

export interface EffectHandlers {
  readonly apply: (effect: ShinsaEffect, attempt: EffectAttempt) => Effect.Effect<void, EffectFailure>;
  readonly exhausted: (
    effect: ShinsaEffect,
    error: string,
    key: string
  ) => Effect.Effect<void, EffectFailure>;
  readonly retry: (
    effect: ShinsaEffect,
    retry: EffectRetry,
    key: string
  ) => Effect.Effect<void, EffectFailure>;
}

export interface DispatchOptions {
  id?: string;
  onBehalf?: boolean;
  byTask?: string | null;
  guest?: GuestActor | null;
  receipt?: ShinsaCommand;
}

export interface BehalfContext {
  onBehalf: boolean;
  byTask: string | null;
  guest: GuestActor | null;
}

export interface WrittenBriefing {
  text: string;
  briefing: Briefing;
}

export interface EngineOptions {
  readOnly?: boolean;
  stateVersion?: string | null;
  snapshotEvery?: number;
  snapshotQuietMs?: number;
}

export class EngineStopped extends Schema.TaggedError<EngineStopped, { readonly brand: unique symbol }>()(
  'EngineStopped',
  { message: Schema.String }
) {}

export class ListenerFailed extends Schema.TaggedError<ListenerFailed, { readonly brand: unique symbol }>()(
  'ListenerFailed',
  { message: Schema.String }
) {}

export const SHUTTING_DOWN = 'Shinsa is shutting down.';

export const IDLE_POLL = Duration.seconds(30);

export const PUMP_FLOOR = Duration.millis(1);

export const TARGET_FIELDS = ['taskId', 'runId', 'gateId', 'repoId', 'projectId'] as const;

export const SNAPSHOT_EVERY = 2_000;

export const SNAPSHOT_QUIET_MS = 3_000;
