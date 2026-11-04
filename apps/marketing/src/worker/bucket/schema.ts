import { type Effect, Schema } from 'effect';

export class BucketUnbound extends Schema.TaggedError<BucketUnbound, { readonly brand: unique symbol }>()(
  'BucketUnbound',
  { key: Schema.String }
) {}

export class BucketFailed extends Schema.TaggedError<BucketFailed, { readonly brand: unique symbol }>()(
  'BucketFailed',
  { key: Schema.String, error: Schema.String }
) {}

export interface BucketObject {
  readonly body: ReadableStream | null;
  readonly text: Effect.Effect<string, BucketFailed>;
}
