import { describe, expect, test } from 'bun:test';
import { Clock, Effect, Fiber, Layer, Ref } from 'effect';
import { TestClock } from 'effect/testing';
import { ConfigTest } from './harness.ts';
import { Connector, Tunnel, TunnelError } from './tunnel.ts';

const URL = 'https://studio.shinsa.dev';

const openTunnel = (connector: Connector['Service']) =>
  Effect.gen(function* () {
    const tunnel = yield* Tunnel;
    return tunnel.url;
  }).pipe(
    Effect.provide(Tunnel.layer.pipe(Layer.provide([Layer.succeed(Connector, connector), ConfigTest])))
  );

const runWithClock = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.runPromise(Effect.provide(effect, TestClock.layer()));

const recordAttempt = (attempts: Ref.Ref<readonly number[]>) =>
  Effect.flatMap(Clock.currentTimeMillis, (now) => Ref.updateAndGet(attempts, (times) => [...times, now]));

describe('a resource is acquired with a timeout and a retry schedule, and released with its scope', () => {
  test('a refused connection is retried at 1, 2 and 4 seconds, then closed when its scope ends', async () => {
    const result = await runWithClock(
      Effect.gen(function* () {
        const attempts = yield* Ref.make<readonly number[]>([]);
        const closed = yield* Ref.make(false);
        const fiber = yield* Effect.forkChild(
          openTunnel({
            open: () =>
              Effect.gen(function* () {
                const times = yield* recordAttempt(attempts);
                if (times.length < 4) return yield* new TunnelError({ message: 'Refused.', retryable: true });
                return { url: URL, close: Ref.set(closed, true) };
              }),
          })
        );
        yield* TestClock.adjust('10 seconds');
        return {
          url: yield* Fiber.join(fiber),
          attempts: yield* Ref.get(attempts),
          closed: yield* Ref.get(closed),
        };
      })
    );
    expect(result).toEqual({ url: URL, attempts: [0, 1_000, 3_000, 7_000], closed: true });
  });

  test('a connection that hangs times out and is tried again; one that cannot be retried fails at once', async () => {
    const result = await runWithClock(
      Effect.gen(function* () {
        const attempts = yield* Ref.make<readonly number[]>([]);
        const fiber = yield* Effect.forkChild(
          openTunnel({
            open: () =>
              Effect.gen(function* () {
                const times = yield* recordAttempt(attempts);
                if (times.length === 1) return yield* Effect.never;
                return { url: URL, close: Effect.void };
              }),
          })
        );
        yield* TestClock.adjust('31 seconds');
        const refused = yield* Effect.flip(
          openTunnel({ open: () => new TunnelError({ message: 'Revoked.', retryable: false }) })
        );
        return { url: yield* Fiber.join(fiber), attempts: yield* Ref.get(attempts), refused };
      })
    );
    expect(result.url).toBe(URL);
    expect(result.attempts).toEqual([0, 31_000]);
    expect(result.refused).toMatchObject({ _tag: 'TunnelError', message: 'Revoked.' });
  });
});
