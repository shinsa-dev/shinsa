import { describe, expect, test } from 'bun:test';
import { Effect, Fiber, Layer } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { TestClock } from 'effect/testing';
import { NpmRegistry } from '../../../src/versions/registry/service.ts';

function provideFetch(answer: (url: string | URL | Request) => Promise<Response>) {
  return NpmRegistry.layer.pipe(
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(
      Layer.succeed(FetchHttpClient.Fetch, Object.assign(answer, { preconnect: fetch.preconnect }))
    )
  );
}

function readLatest(answer: () => Promise<Response>, name = '@openai/codex') {
  return Effect.runPromise(
    Effect.flip(NpmRegistry.use((registry) => registry.latest(name))).pipe(
      Effect.provide(provideFetch(answer))
    )
  );
}

describe('NpmRegistry', () => {
  test('reads the latest dist-tag of a package from the npm registry', async () => {
    const asked: string[] = [];
    const answer = (url: string | URL | Request) => {
      asked.push(String(url));
      return Promise.resolve(Response.json({ name: '@openai/codex', version: '0.164.0' }));
    };
    const version = await Effect.runPromise(
      NpmRegistry.use((registry) => registry.latest('@openai/codex')).pipe(
        Effect.provide(provideFetch(answer))
      )
    );
    expect(version).toBe('0.164.0');
    expect(asked).toEqual(['https://registry.npmjs.org/@openai/codex/latest']);
  });

  test('a refusal or an answer without a version is a failed read', async () => {
    const refused = await readLatest(() => Promise.resolve(new Response('nope', { status: 404 })), 'missing');
    expect(refused.message).toBe('The npm registry answered 404 for missing.');
    const empty = await readLatest(() => Promise.resolve(Response.json(null)), 'odd');
    expect(empty.message).toBe('The npm registry gave no version for odd.');
  });

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
