import { describe, expect, test } from 'bun:test';
import { Deferred, Effect, Fiber } from 'effect';
import { ObjectCacheBytes } from '../../src/git/objects/schema.ts';
import { ObjectCache } from '../../src/git/objects/service.ts';

function runCache<A, E>(effect: Effect.Effect<A, E, ObjectCache>, limit?: number) {
  const cached = effect.pipe(Effect.provide(ObjectCache.layer));
  return Effect.runPromise(
    limit === undefined ? cached : Effect.provideService(cached, ObjectCacheBytes, limit)
  );
}

const length = (value: string) => value.length;

describe('ObjectCache', () => {
  test('serves a second read of the same key from memory', async () => {
    await runCache(
      Effect.gen(function* () {
        const cache = yield* ObjectCache;
        let reads = 0;
        const create = Effect.sync(() => {
          reads += 1;
          return 'value';
        });
        expect(yield* cache.read('a', create, length)).toBe('value');
        expect(yield* cache.read('a', create, length)).toBe('value');
        expect(reads).toBe(1);
      })
    );
  });

  test('drops the least recently used entries once over its byte budget, never the newest', async () => {
    await runCache(
      Effect.gen(function* () {
        const cache = yield* ObjectCache;
        yield* cache.read('a', Effect.succeed('aaaa'), length);
        yield* cache.read('b', Effect.succeed('bbbb'), length);
        yield* cache.read('a', Effect.succeed('unused'), length);
        yield* cache.read('c', Effect.succeed('cccc'), length);
        expect(yield* cache.size).toBe(2);
        expect(yield* cache.read('a', Effect.succeed('again'), length)).toBe('aaaa');
        expect(yield* cache.read('b', Effect.succeed('fresh'), length)).toBe('fresh');
        yield* cache.read('huge', Effect.succeed('x'.repeat(50)), length);
        expect(yield* cache.size).toBe(1);
      }),
      10
    );
  });

  test('forgets a failed read, so the next one tries again', async () => {
    await runCache(
      Effect.gen(function* () {
        const cache = yield* ObjectCache;
        expect(yield* Effect.flip(cache.read('a', Effect.fail('gone'), () => 0))).toBe('gone');
        expect(yield* cache.size).toBe(0);
        expect(yield* cache.read('a', Effect.succeed('back'), length)).toBe('back');
      })
    );
  });

  test('an entry evicted while it loads is not counted when it lands', async () => {
    await runCache(
      Effect.gen(function* () {
        const cache = yield* ObjectCache;
        const finish = yield* Deferred.make<string>();
        const slow = yield* Effect.forkChild(cache.read('slow', Deferred.await(finish), length));
        yield* Effect.yieldNow;
        yield* cache.read('a', Effect.succeed('aaaa'), length);
        yield* cache.read('b', Effect.succeed('bbbb'), length);
        yield* Deferred.succeed(finish, 'late');
        expect(yield* Fiber.join(slow)).toBe('late');
        expect(yield* cache.size).toBe(1);
      }),
      4
    );
  });

  test('a failure for an entry another read replaced leaves that read alone', async () => {
    await runCache(
      Effect.gen(function* () {
        const cache = yield* ObjectCache;
        const fail = yield* Deferred.make<string, string>();
        const failing = yield* Effect.forkChild(Effect.flip(cache.read('x', Deferred.await(fail), () => 0)));
        yield* Effect.yieldNow;
        yield* cache.read('a', Effect.succeed('aaaa'), length);
        yield* cache.read('b', Effect.succeed('bbbb'), length);
        yield* cache.read('x', Effect.succeed('xx'), length);
        yield* Deferred.fail(fail, 'late');
        expect(yield* Fiber.join(failing)).toBe('late');
        expect(yield* cache.read('x', Effect.succeed('other'), length)).toBe('xx');
      }),
      4
    );
  });
});
