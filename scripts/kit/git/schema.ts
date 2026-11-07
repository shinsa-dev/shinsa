import { Schema } from 'effect';

export class GitCommandFailed extends Schema.TaggedError<
  GitCommandFailed,
  { readonly brand: unique symbol }
>()('GitCommandFailed', {
  command: Schema.String,
  code: Schema.Number,
  stderr: Schema.String,
  message: Schema.String,
}) {}

export interface GitOptions {
  readonly at?: number;
  readonly index?: string;
  readonly input?: string | Uint8Array;
  readonly env?: Record<string, string>;
}

export const CLEAN_GIT_CONFIG = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
