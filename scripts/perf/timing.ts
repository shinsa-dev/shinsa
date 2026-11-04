import { Clock, Effect } from 'effect';

export const elapsedSince = (started: bigint) =>
  Effect.map(Clock.currentTimeNanos, (now) => Number(now - started) / 1e6);
