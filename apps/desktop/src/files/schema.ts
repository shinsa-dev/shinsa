import { Schema } from 'effect';

export class FileWriteFailed extends Schema.TaggedError<FileWriteFailed, { readonly brand: unique symbol }>()(
  'FileWriteFailed',
  { path: Schema.String, message: Schema.String }
) {}
