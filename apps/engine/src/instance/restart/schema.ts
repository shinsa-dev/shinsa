import type { DomainError, EngineRestartWhen, ShinsaState } from '@shinsa/core';
import { Duration, type Effect, type Fiber, Schema } from 'effect';

export class RestartFailed extends Schema.TaggedError<RestartFailed, { readonly brand: unique symbol }>()(
  'RestartFailed',
  { message: Schema.String }
) {}

export class StopFailed extends Schema.TaggedError<StopFailed, { readonly brand: unique symbol }>()(
  'StopFailed',
  { message: Schema.String }
) {}

export interface RestartSource {
  readonly state: ShinsaState;
  subscribe: (listener: (state: ShinsaState) => void) => () => void;
}

export interface RestartDrain {
  holdNewRuns: (onHeld: () => void) => void;
  releaseHeldRuns: () => void;
  isHeld: (runId: string) => boolean;
}

export interface EngineRestartOptions {
  isService: () => Promise<boolean>;
  restart: () => Promise<unknown>;
  drain?: RestartDrain;
  drainMs?: number;
  now?: () => number;
  schedule?: (run: () => void) => void;
}

export type EngineRestartPending = 'idle' | null;

interface RestartAnswer {
  restarting: boolean;
}

export interface RestartDefinition {
  readonly state: Effect.Effect<ShinsaState>;
  readonly watch: (onChange: Effect.Effect<void>) => Effect.Effect<() => void>;
  readonly isService: Effect.Effect<boolean, RestartFailed>;
  readonly restart: Effect.Effect<void, RestartFailed>;
  readonly hold: (onHeld: Effect.Effect<void>) => Effect.Effect<void>;
  readonly release: Effect.Effect<void>;
  readonly isHeld: (runId: string) => boolean;
  readonly drain: Duration.Duration;
  readonly now: Effect.Effect<number>;
  readonly schedule: (run: Effect.Effect<void>) => Effect.Effect<void>;
}

export interface RestartControl {
  readonly pending: EngineRestartPending;
  readonly deadlineAt: number | null;
  readonly deadline: Fiber.Fiber<void> | null;
  readonly stopWatching: (() => void) | null;
  readonly restarting: boolean;
}

export interface EngineRestarterHandle {
  readonly pending: Effect.Effect<EngineRestartPending>;
  readonly deadlineAt: Effect.Effect<number | null>;
  request(when: EngineRestartWhen): Effect.Effect<RestartAnswer, DomainError | RestartFailed>;
}

export const RESTART_DRAIN = Duration.minutes(15);

export const RESTART_DELAY = Duration.millis(250);

export const EXIT_RESTART = 75;

export const STOP_DEADLINE_MS = 30_000;

export type StopOutcome = 'stopped' | 'failed' | 'timed_out';
