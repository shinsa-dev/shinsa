import { Context, Duration, Schema } from 'effect';

export const ClassifyTimeout = Context.Reference<Duration.Duration>(
  'shinsa/engine/triage/inbox/ClassifyTimeout',
  {
    defaultValue: () => Duration.seconds(30),
  }
);

export class InboxDispatchFailed extends Schema.TaggedError<
  InboxDispatchFailed,
  { readonly brand: unique symbol }
>()('InboxDispatchFailed', { message: Schema.String }) {}
