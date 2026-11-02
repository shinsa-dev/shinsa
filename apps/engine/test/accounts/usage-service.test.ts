import { describe, expect, test } from 'bun:test';
import { Effect, Fiber, Layer } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { TestClock } from 'effect/testing';
import { UsageApi } from '../../src/accounts/usage/service.ts';

const NEVER = Object.assign(() => new Promise<Response>(() => undefined), { preconnect: fetch.preconnect });

describe('UsageApi', () => {
  test('Claude that does not answer within five seconds is a failed read', async () => {
    const layer = UsageApi.layer.pipe(
      Layer.provide(FetchHttpClient.layer),
      Layer.provide(Layer.succeed(FetchHttpClient.Fetch, NEVER))
    );
    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(Effect.flip(UsageApi.use((usage) => usage.request('token'))));
        yield* TestClock.adjust('5 seconds');
        return yield* Fiber.join(fiber);
      }).pipe(Effect.provide(Layer.merge(layer, TestClock.layer())))
    );
    expect(error).toMatchObject({ _tag: 'UsageReadFailed', reason: 'failed', retryAfterMs: null });
    expect(error.detail).toStartWith('Could not reach Claude: no answer within ');
  });
});
