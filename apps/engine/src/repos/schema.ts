import type { Repo } from '@shinsa/core';
import { Duration, type Effect, Schema } from 'effect';

export const LocalRepo = Schema.Struct({
  path: Schema.String,
  name: Schema.String,
  touchedAt: Schema.Number,
});
export type LocalRepo = typeof LocalRepo.Type;

const RootCandidate = Schema.Struct({
  path: Schema.String,
  repoCount: Schema.Number,
  repos: Schema.mutable(Schema.Array(Schema.String)),
});
type RootCandidate = typeof RootCandidate.Type;

export interface Discovery {
  candidates: RootCandidate[];
  truncated: boolean;
  refused: string[];
}

export interface DiscoveryOptions {
  readonly maxDepth?: number;
  readonly maxDirs?: number;
  readonly budget?: Duration.Duration;
}

export interface DiscoveryScan {
  readonly home: string;
  readonly parents: Map<string, string[]>;
  readonly refused: string[];
}

export interface SetupScope {
  readonly defaultBranch: boolean;
}

export type RootSourceKind = 'configured' | 'environment' | 'discovered';

export interface RootSource {
  readonly listRoots: Effect.Effect<string[]>;
}

export type Discoverer = (home: string) => Promise<Discovery>;

export type LoginResolver = () => Promise<string | null>;

export class RepoNotRegistered extends Schema.TaggedError<
  RepoNotRegistered,
  { readonly brand: unique symbol }
>()('RepoNotRegistered', { path: Schema.String, message: Schema.String }) {}

export class RepoNotCreated extends Schema.TaggedError<RepoNotCreated, { readonly brand: unique symbol }>()(
  'RepoNotCreated',
  { path: Schema.String, message: Schema.String }
) {}

export type SetupTarget = Pick<Repo, 'path' | 'defaultBranch'>;

export const REPOSITORY_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export const FALLBACK_DEFAULT_BRANCH = 'main';

export const MAX_DEPTH = 8;

export const MAX_DIRS = 150_000;

export const DISCOVERY_BUDGET = Duration.seconds(20);

export const REFUSED_CODES = new Set(['EPERM', 'EACCES']);

export const SAMPLE_REPOS = 8;

export const MAX_LOCAL_REPOS = 80;

export const SKIPPED_DIRS = new Set([
  'node_modules',
  'Library',
  'Applications',
  'Caches',
  'cache',
  'Cache',
  'Pods',
  'DerivedData',
  'venv',
]);

export const BUNDLE_SUFFIXES = [
  '.app',
  '.bundle',
  '.framework',
  '.photoslibrary',
  '.musiclibrary',
  '.tvlibrary',
  '.imovielibrary',
  '.fcpbundle',
  '.logicx',
  '.band',
  '.xcarchive',
  '.xcodeproj',
  '.xcworkspace',
];

export const DISCOVERY_TTL_MS = 10 * 60 * 1000;

export const ORIGIN_SECTION = /^\s*\[remote\s+"origin"\]\s*$/;

export const SECTION = /^\s*\[/;

export const URL_LINE = /^\s*url\s*=\s*(\S+)\s*$/;

export const SETUP_FETCH_TIMEOUT = Duration.minutes(1);

export const SETUP_PUSH_TIMEOUT = Duration.minutes(1);

export const FIRST_COMMIT_MESSAGE = 'chore: start the repository';
