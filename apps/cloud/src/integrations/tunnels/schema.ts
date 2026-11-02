import { Schema } from 'effect';

export class TunnelUnreachable extends Schema.TaggedError<TunnelUnreachable, { readonly brand: unique symbol }>()('TunnelUnreachable', {
  instanceId: Schema.String,
  message: Schema.String,
}) {}
