import type { RepoEntry, RepoEntryKind } from '@shinsa/core';
import { type Effect, Schema } from 'effect';

const CodeReadCode = Schema.Literals(['read_timeout', 'read_failed', 'ref_invalid', 'ref_unknown']);

export class CodeReadFailed extends Schema.TaggedError<CodeReadFailed, { readonly brand: unique symbol }>()(
  'CodeReadFailed',
  { code: CodeReadCode, message: Schema.String }
) {}

export class ObjectReaderStopped extends Schema.TaggedError<
  ObjectReaderStopped,
  { readonly brand: unique symbol }
>()('ObjectReaderStopped', { message: Schema.String }) {}

export const ObjectInfo = Schema.Struct({ object: Schema.String, type: Schema.String, size: Schema.Number });
export type ObjectInfo = typeof ObjectInfo.Type;

export interface BatchReader {
  readonly info: (name: string) => Effect.Effect<ObjectInfo | null, ObjectReaderStopped>;
  readonly contents: (object: string) => Effect.Effect<Uint8Array, ObjectReaderStopped>;
}

export interface SearchQuery {
  query: string;
  regex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  glob: string | null;
}

export interface TreeRecord {
  entry: RepoEntry;
  object: string;
}

export interface BlobRef {
  object: string;
  size: number;
}

export const LIST_BYTES = 64 * 1024 * 1024;

export const SEARCH_BYTES = 4 * 1024 * 1024;

export const MATCH_TEXT = 500;

export const BINARY_SNIFF_BYTES = 8000;

export const VERIFIED_LIMIT = 10_000;

export const SYMLINK_MODE = '120000';

export const ENTRY_KIND: Record<string, RepoEntryKind> = {
  blob: 'file',
  tree: 'directory',
  commit: 'submodule',
};

export const TREE_MODES: Record<string, RepoEntryKind> = {
  '40000': 'directory',
  '160000': 'submodule',
  [SYMLINK_MODE]: 'symlink',
};

export const ERE_SPECIAL = /[\\^$.|?*+()[\]{}]/g;
