import { Context, Duration, type Effect, type Fiber, Schema, type Scope } from 'effect';

export class RestartFailed extends Schema.TaggedError<RestartFailed, { readonly brand: unique symbol }>()(
  'RestartFailed',
  { message: Schema.String }
) {}

export class StopFailed extends Schema.TaggedError<StopFailed, { readonly brand: unique symbol }>()(
  'StopFailed',
  { message: Schema.String }
) {}

export interface RestartDrain {
  readonly holdNewRuns: (onHeld: Effect.Effect<void>) => Effect.Effect<void>;
  readonly releaseHeldRuns: Effect.Effect<void>;
  readonly isHeld: (runId: string) => Effect.Effect<boolean>;
}

export interface EngineRestartInput {
  readonly isService: Effect.Effect<boolean, RestartFailed>;
  readonly restart: Effect.Effect<void, RestartFailed>;
  readonly drain?: RestartDrain | undefined;
}

export interface ServiceRestart {
  byService: boolean;
  stop: Effect.Effect<void>;
  drain?: RestartDrain;
  exit?: (code: number) => void;
  deadlineMs?: number;
}

export type EngineRestartPending = 'idle' | null;

export interface RestartAnswer {
  restarting: boolean;
}

export interface RestartControl {
  readonly pending: EngineRestartPending;
  readonly deadlineAt: number | null;
  readonly deadline: Fiber.Fiber<void> | null;
  readonly watching: Scope.Closeable | null;
  readonly restarting: boolean;
}

export const RestartDrainWindow = Context.Reference<Duration.Duration>(
  'shinsa/engine/instance/restart/RestartDrainWindow',
  { defaultValue: () => Duration.minutes(15) }
);

export const RestartDelay = Context.Reference<Duration.Duration>(
  'shinsa/engine/instance/restart/RestartDelay',
  {
    defaultValue: () => Duration.millis(250),
  }
);

export const EXIT_RESTART = 75;

export const STOP_DEADLINE_MS = 30_000;

export type StopOutcome = 'stopped' | 'failed' | 'timed_out';
