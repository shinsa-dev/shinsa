import { CODE_LIMITS } from '@shinsa/core';
import { Duration, Schema } from 'effect';
import type { CommandEnv } from '../../shell/schema.ts';

export class CodeUnavailable extends Schema.TaggedError<CodeUnavailable, { readonly brand: unique symbol }>()(
  'CodeUnavailable',
  { message: Schema.String }
) {}

export class DiffFailed extends Schema.TaggedError<DiffFailed, { readonly brand: unique symbol }>()(
  'DiffFailed',
  {
    message: Schema.String,
  }
) {}

export class ChangesUnreadable extends Schema.TaggedError<
  ChangesUnreadable,
  { readonly brand: unique symbol }
>()('ChangesUnreadable', { message: Schema.String }) {}

export interface DiffSource {
  readonly cwd: string;
  readonly range: readonly string[];
  readonly env?: CommandEnv | undefined;
  readonly signal?: AbortSignal | undefined;
}

export const CODE_UNAVAILABLE_MESSAGE = 'This task’s code is no longer here.';

export const DIFF_TOO_LARGE_MESSAGE = 'The change is too large to show.';

export const MAX_COMMITS = 100;

export const COMMIT_FIELD = '\u001f';

export const DIFF_ARGS = ['diff', '--no-color', '--no-ext-diff', '--find-renames'];

export const DIFF_BYTES = 64 * 1024 * 1024;

export const DIFF_TIMEOUT = Duration.seconds(30);

export const NAMED_LIMITS = { fileBytes: CODE_LIMITS.blobBytes, totalBytes: 2 * CODE_LIMITS.blobBytes };

export const SCRATCH_PREFIX = 'shinsa-diff-';
