import { type Clock, Context, type Effect } from 'effect';

export interface RunClockState {
  readonly remaining: number;
  readonly startedAt: number;
  readonly pauses: number;
  readonly armed: boolean;
  readonly stopped: boolean;
}

export interface RunClockHandle {
  readonly start: Effect.Effect<void>;
  readonly pause: Effect.Effect<void>;
  readonly resume: Effect.Effect<void>;
  readonly stop: Effect.Effect<void>;
}

export const RunClockTime = Context.Reference<Clock.Clock | null>('shinsa/engine/agents/clock/RunClockTime', {
  defaultValue: () => null,
});
