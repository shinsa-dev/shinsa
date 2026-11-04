import { Schema } from 'effect';

export const COMPLETION_TIMEOUT_MS = 45_000;

export const STRUCTURED_TIMEOUT_MS = 20_000;

export const MAX_TEXT = 12_000;

export const MAX_MESSAGE = 500;

export class ProviderCallFailed extends Schema.TaggedError<
  ProviderCallFailed,
  { readonly brand: unique symbol }
>()('ProviderCallFailed', { provider: Schema.String, message: Schema.String }) {}
