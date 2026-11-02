import type { Effect } from 'effect';

export interface ClockTimers {
  now: () => number;
  start: (fire: () => void, ms: number) => unknown;
  clear: (timer: unknown) => void;
}

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

export const NANOS_PER_MS = 1_000_000n;
