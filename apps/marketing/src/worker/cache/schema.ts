import { Schema } from 'effect';

export const CACHE_SECONDS = 60;

export class CacheFailed extends Schema.TaggedError<CacheFailed, { readonly brand: unique symbol }>()(
  'CacheFailed',
  { key: Schema.String }
) {}
