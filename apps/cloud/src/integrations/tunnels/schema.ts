import { Schema } from 'effect';

export class TunnelUnreachable extends Schema.TaggedError<TunnelUnreachable>()('TunnelUnreachable', {
  instanceId: Schema.String,
  message: Schema.String,
}) {}
