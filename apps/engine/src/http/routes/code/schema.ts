import type { Task } from '@shinsa/core';
import type { FieldFailure } from '@shinsa/core/engine-api/schema';

export interface CodeTask {
  readonly task: Task;
  readonly repoPath: string;
  readonly worktree: string | null;
}

export type ResolvedRef =
  | { readonly kind: 'commit'; readonly sha: string }
  | { readonly kind: 'working'; readonly worktree: string };

export const IMMUTABLE = 'private, max-age=31536000, immutable';

export const NO_STORE = 'no-store';

export const NDJSON = 'application/x-ndjson';

export const MAX_GLOB_LENGTH = 200;

export const CODE_MISSING_MESSAGE = 'This task has no code to read.';

export const IMAGE_MISSING_MESSAGE = 'There is no such image at this commit.';

export const NO_REPOSITORY: FieldFailure = {
  code: 'code_unavailable',
  message: 'This task has no repository.',
};

export const NO_WORKING_COPY: FieldFailure = {
  code: 'ref_invalid',
  message: 'This task has no working copy any more.',
};

export const PATH_LEAVES_WORKTREE: FieldFailure = {
  code: 'path_invalid',
  message: 'That path leaves the working copy.',
};

export const NOT_AN_IMAGE: FieldFailure = {
  code: 'not_an_image',
  message: 'Only images are served as they are.',
};

export const GLOB_FAILURE: FieldFailure = {
  code: 'glob_invalid',
  message: 'Use a pattern such as src/**/*.ts.',
};

export const SEARCH_FAILED = 'search_failed';

export const RAW_SAFETY = {
  'Content-Security-Policy': "default-src 'none'",
  'X-Content-Type-Options': 'nosniff',
} as const;
