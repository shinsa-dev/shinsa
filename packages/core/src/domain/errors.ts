import { Schema } from 'effect';

export class DomainError extends Schema.TaggedError<DomainError>()('DomainError', {
  code: Schema.String,
  message: Schema.String,
}) {}
