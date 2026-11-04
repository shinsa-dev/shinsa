import { Context, Effect, Layer, Option } from 'effect';
import type { BucketHeadObject, ByteRange } from '../platform/schema.ts';
import { WorkerBindings } from '../platform/service.ts';
import { BucketFailed, type BucketObject, BucketUnbound } from './schema.ts';

export class Bucket extends Context.Service<
  Bucket,
  {
    head(key: string): Effect.Effect<Option.Option<BucketHeadObject>, BucketUnbound | BucketFailed>;
    get(
      key: string,
      range: Option.Option<ByteRange>
    ): Effect.Effect<Option.Option<BucketObject>, BucketUnbound | BucketFailed>;
  }
>()('shinsa/marketing/worker/bucket/Bucket') {
  static readonly layer = Layer.effect(
    Bucket,
    Effect.gen(function* () {
      const { downloads } = yield* WorkerBindings;

      const failWith = (key: string) => (error: unknown) => new BucketFailed({ key, error: String(error) });

      const findBinding = (key: string) =>
        Option.match(downloads, {
          onNone: () => Effect.fail(new BucketUnbound({ key })),
          onSome: Effect.succeed,
        });

      const head = Effect.fn('Bucket.head')(function* (key: string) {
        const binding = yield* findBinding(key);
        const object = yield* Effect.tryPromise({ try: () => binding.head(key), catch: failWith(key) });
        return Option.fromNullishOr(object);
      });

      const get = Effect.fn('Bucket.get')(function* (key: string, range: Option.Option<ByteRange>) {
        const binding = yield* findBinding(key);
        const options = Option.match(range, { onNone: () => undefined, onSome: (only) => ({ range: only }) });
        const object = yield* Effect.tryPromise({
          try: () => binding.get(key, options),
          catch: failWith(key),
        });
        return Option.map(Option.fromNullishOr(object), (found): BucketObject => ({
          body: found.body,
          text: Effect.tryPromise({ try: () => found.text(), catch: failWith(key) }),
        }));
      });

      return Bucket.of({ head, get });
    })
  );
}
