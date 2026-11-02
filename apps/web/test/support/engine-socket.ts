import { Clock, Duration, Effect, Layer } from 'effect';
import { Socket } from 'effect/socket';
import { SOCKET_OPEN_TIMEOUT } from '@/lib/runtime/socket/schema.ts';

export interface PendingRetry {
  delayMs: number;
  reconnect: () => void;
  cancelled: boolean;
}

const OPEN_TIMEOUT_MS = Duration.toMillis(Duration.fromInputUnsafe(SOCKET_OPEN_TIMEOUT));

export function createRetryClock(retries: PendingRetry[]): Clock.Clock {
  const sleep = (duration: Duration.Duration) => {
    const delayMs = Duration.toMillis(duration);
    if (delayMs === OPEN_TIMEOUT_MS) return Effect.never;
    return Effect.callback<void>((resume) => {
      const retry: PendingRetry = { delayMs, reconnect: () => resume(Effect.void), cancelled: false };
      retries.push(retry);
      return Effect.sync(() => {
        retry.cancelled = true;
      });
    });
  };
  return Object.assign(Object.create(Clock.Clock.defaultValue()) as Clock.Clock, { sleep });
}

export function createSocketTransport<S extends Socket.WebSocketLike>(
  open: (url: string) => S,
  retries: PendingRetry[] = []
): Layer.Layer<Socket.WebSocketConstructor> {
  return Layer.mergeAll(
    Layer.succeed(Socket.WebSocketConstructor, (url) => open(url)),
    Layer.succeed(Clock.Clock, createRetryClock(retries))
  );
}
