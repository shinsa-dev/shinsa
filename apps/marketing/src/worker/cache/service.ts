import { Context, Effect, Layer, Option, Schema } from 'effect';
import { WorkerBindings } from '../platform/service.ts';
import { CACHE_SECONDS, CacheFailed } from './schema.ts';

export class EdgeCache extends Context.Service<
  EdgeCache,
  {
    remember<A, I, E>(
      key: string,
      schema: Schema.Codec<A, I>,
      produce: Effect.Effect<Option.Option<A>, E>
    ): Effect.Effect<Option.Option<A>, E | CacheFailed>;
  }
>()('shinsa/marketing/worker/cache/EdgeCache') {
  static readonly layer = Layer.effect(
    EdgeCache,
    Effect.gen(function* () {
      const { cache } = yield* WorkerBindings;

      const remember = Effect.fn('EdgeCache.remember')(function* <A, I, E>(
        key: string,
        schema: Schema.Codec<A, I>,
        produce: Effect.Effect<Option.Option<A>, E>
      ): Effect.fn.Return<Option.Option<A>, E | CacheFailed> {
        if (Option.isNone(cache)) return yield* produce;
        const binding = cache.value;
        const json = Schema.fromJsonString(schema);
        const failed = () => new CacheFailed({ key });
        const cached = yield* Effect.tryPromise({ try: () => binding.match(key), catch: failed });
        if (cached) {
          const text = yield* Effect.tryPromise({ try: () => cached.text(), catch: failed });
          return Option.some(yield* Effect.mapError(Schema.decodeUnknownEffect(json)(text), failed));
        }
        const value = yield* produce;
        if (Option.isNone(value)) return value;
        const text = yield* Effect.mapError(Schema.encodeEffect(json)(value.value), failed);
        const headers = { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${CACHE_SECONDS}` };
        yield* Effect.tryPromise({
          try: () => binding.put(key, new Response(text, { headers })),
          catch: failed,
        });
        return value;
      });

      return EdgeCache.of({ remember });
    })
  );
}
