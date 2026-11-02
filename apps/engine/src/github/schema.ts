import { Duration, Schema } from 'effect';
import type { CommandResult } from '../shell/schema.ts';

export class GitHubFailed extends Schema.TaggedError<GitHubFailed, { readonly brand: unique symbol }>()(
  'GitHubFailed',
  { message: Schema.String }
) {}

export class GitHubAnswerInvalid extends Schema.TaggedError<
  GitHubAnswerInvalid,
  { readonly brand: unique symbol }
>()('GitHubAnswerInvalid', { message: Schema.String }) {}

export class NoGitHubRemote extends Schema.TaggedError<NoGitHubRemote, { readonly brand: unique symbol }>()(
  'NoGitHubRemote',
  { message: Schema.String }
) {}

export const RepoSlug = Schema.Struct({ owner: Schema.String, name: Schema.String });
export type RepoSlug = typeof RepoSlug.Type;

export interface GitHubRun {
  readonly input?: string | undefined;
  readonly signal?: AbortSignal | undefined;
}

export type GitHubAnswer = (args: readonly string[], input: string | undefined) => CommandResult;

export const GITHUB_TIMEOUT = Duration.minutes(1);

export const NO_GITHUB_REMOTE = 'The repository has no GitHub remote.';
