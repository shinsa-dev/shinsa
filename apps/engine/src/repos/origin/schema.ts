import type { Repo } from '@shinsa/core';
import { Duration, Schema } from 'effect';

export type OriginTarget = Pick<Repo, 'path' | 'name' | 'defaultBranch'>;

export const GitHubRepository = Schema.Struct({
  isEmpty: Schema.Boolean,
  url: Schema.String,
  sshUrl: Schema.String,
});
export type GitHubRepository = typeof GitHubRepository.Type;

export class OriginNotConnected extends Schema.TaggedError<
  OriginNotConnected,
  { readonly brand: unique symbol }
>()('OriginNotConnected', { path: Schema.String, message: Schema.String }) {}

export const REPOSITORY_FIELDS = 'isEmpty,url,sshUrl';

export const MISSING_REPOSITORY = /Could not resolve to a Repository/i;

export const ORIGIN_PUSH_TIMEOUT = Duration.minutes(1);

export const UNKNOWN_OWNER = '<owner>';

export const GITHUB_REMOTE_OWNER = /^github\.com\/([^/]+)\/[^/]+$/i;
