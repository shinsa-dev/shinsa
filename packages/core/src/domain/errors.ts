import { Schema } from 'effect';

export class DomainError extends Schema.TaggedError<DomainError, { readonly brand: unique symbol }>()(
  'DomainError',
  {
    code: Schema.String,
    message: Schema.String,
  }
) {}
