import { Schema } from 'effect';

export class FileWriteFailed extends Schema.TaggedError<FileWriteFailed, { readonly brand: unique symbol }>()(
  'FileWriteFailed',
  { path: Schema.String, message: Schema.String }
) {}

export type FileEntry = { kind: 'missing' } | { kind: 'link'; target: string } | { kind: 'file' };
