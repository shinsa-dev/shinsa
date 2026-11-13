import { Schema } from 'effect';

export const RELAY_NOT_JOINED = 'This machine has not connected to the relay yet.';

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
