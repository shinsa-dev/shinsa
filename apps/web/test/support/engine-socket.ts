import { Clock, Duration, Effect, Layer } from 'effect';
import { Socket } from 'effect/socket';
import { ENGINE_OPEN_TIMEOUT } from '@/lib/connection/engine-socket/schema.ts';

export interface PendingRetry {
  delayMs: number;
  reconnect: () => void;
}

const OPEN_TIMEOUT_MS = Duration.toMillis(Duration.fromInputUnsafe(ENGINE_OPEN_TIMEOUT));

export function createRetryClock(retries: PendingRetry[]): Clock.Clock {
  const sleep = (duration: Duration.Duration) => {
    const delayMs = Duration.toMillis(duration);
    if (delayMs === OPEN_TIMEOUT_MS) return Effect.never;
    return Effect.callback<void>((resume) => {
      retries.push({ delayMs, reconnect: () => resume(Effect.void) });
    });
  };
  return Object.assign(Object.create(Clock.Clock.defaultValue()) as Clock.Clock, { sleep });
}

export function createSocketTransport<S extends Socket.WebSocketLike>(
  open: () => S,
  retries: PendingRetry[] = []
): Layer.Layer<Socket.WebSocketConstructor> {
  return Layer.mergeAll(
    Layer.succeed(Socket.WebSocketConstructor, () => open()),
    Layer.succeed(Clock.Clock, createRetryClock(retries))
  );
}
