import { describe, expect, test } from 'bun:test';
import { Effect, Fiber, Layer } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { TestClock } from 'effect/testing';
import { NpmRegistry } from '../../../src/versions/registry/service.ts';

function provideFetch(answer: () => Promise<Response>) {
  return NpmRegistry.layer.pipe(
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(
      Layer.succeed(FetchHttpClient.Fetch, Object.assign(answer, { preconnect: fetch.preconnect }))
    )
  );
}

function readLatest(answer: () => Promise<Response>) {
  return Effect.runPromise(
    Effect.flip(NpmRegistry.use((registry) => registry.latest('@openai/codex'))).pipe(
      Effect.provide(provideFetch(answer))
    )
  );
}

describe('NpmRegistry', () => {
  test('a registry that does not answer within ten seconds is a failed read naming the package', async () => {
    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(
          Effect.flip(NpmRegistry.use((registry) => registry.latest('@openai/codex')))
        );
        yield* TestClock.adjust('10 seconds');
        return yield* Fiber.join(fiber);
      }).pipe(
        Effect.provide(
          Layer.merge(
            provideFetch(() => new Promise<Response>(() => undefined)),
            TestClock.layer()
          )
        )
      )
    );
    expect(error).toMatchObject({ _tag: 'NpmRegistryFailed', packageName: '@openai/codex' });
    expect(error.message).toBe('The npm registry gave no answer for @openai/codex within 10s.');
  });

  test('a registry it cannot reach, or one that answers text that is not JSON, is a failed read', async () => {
    const unreachable = await readLatest(() => Promise.reject(new TypeError('connection refused')));
    expect(unreachable.message).toStartWith('The npm registry could not be reached for @openai/codex: ');
    const garbled = await readLatest(() => Promise.resolve(new Response('<html>')));
    expect(garbled.message).toBe('The npm registry gave no version for @openai/codex.');
  });
});
