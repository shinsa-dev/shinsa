import { Schema } from 'effect';

export class RelayUnreachable extends Schema.TaggedError<
  RelayUnreachable,
  { readonly brand: unique symbol }
>()('RelayUnreachable', {
  instanceId: Schema.String,
  message: Schema.String,
}) {}

export interface RelayRequestInit extends RequestInit {
  readonly address?: string | null;
}
