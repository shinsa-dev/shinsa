import { Schema } from 'effect';

export class JsonFileUnreadable extends Schema.TaggedError<
  JsonFileUnreadable,
  { readonly brand: unique symbol }
>()('JsonFileUnreadable', { path: Schema.String, reason: Schema.String }) {}

export class JsonFileWriteFailed extends Schema.TaggedError<
  JsonFileWriteFailed,
  { readonly brand: unique symbol }
>()('JsonFileWriteFailed', { path: Schema.String, message: Schema.String }) {}

export const JsonText = Schema.fromJsonString(Schema.Unknown);

export const JSON_FILE_MODE = 0o600;

export const JSON_INDENT = 2;
