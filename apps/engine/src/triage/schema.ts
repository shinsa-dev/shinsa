import { Duration, Schema } from 'effect';

export class ClassifierFailed extends Schema.TaggedError<
  ClassifierFailed,
  { readonly brand: unique symbol }
>()('ClassifierFailed', { message: Schema.String }) {}

const CLASSIFY_TIMEOUT = Duration.seconds(30);

export const CLASSIFY_TIMEOUT_MS = Duration.toMillis(CLASSIFY_TIMEOUT);

export const UNDELIVERED_REASON = 'Shinsa could not deliver it. Send it again.';
