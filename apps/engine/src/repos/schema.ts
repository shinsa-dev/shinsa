import { Duration, Schema } from 'effect';

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
}

export interface DiscoveryOptions {
  readonly maxDepth?: number;
  readonly maxDirs?: number;
  readonly skipPrivate?: boolean;
}

export interface SetupScope {
  readonly defaultBranch: boolean;
}

export type RootSourceKind = 'configured' | 'environment' | 'discovered';

export interface RootSource {
  listRoots: () => Promise<string[]>;
}

export type Discoverer = (home: string) => Promise<Discovery>;

export type LoginResolver = () => Promise<string | null>;

export class RepoNotRegistered extends Schema.TaggedError<
  RepoNotRegistered,
  { readonly brand: unique symbol }
>()('RepoNotRegistered', { path: Schema.String, message: Schema.String }) {}

export const PRIVATE_HOME_DIRS = new Set(['Desktop', 'Documents', 'Downloads']);

export const MAX_DEPTH = 4;

export const MAX_DIRS = 20_000;

export const SAMPLE_REPOS = 8;

export const MAX_LOCAL_REPOS = 80;

export const SKIPPED_DIRS = new Set([
  'node_modules',
  'Library',
  'Applications',
  'Caches',
  'cache',
  'Cache',
  'vendor',
  'Pods',
  'DerivedData',
  'build',
  'dist',
  'target',
  'venv',
  'go',
  'Movies',
  'Music',
  'Pictures',
]);

export const DISCOVERY_TTL_MS = 10 * 60 * 1000;

export const ORIGIN_SECTION = /^\s*\[remote\s+"origin"\]\s*$/;

export const SECTION = /^\s*\[/;

export const URL_LINE = /^\s*url\s*=\s*(\S+)\s*$/;

export const SETUP_FETCH_TIMEOUT = Duration.minutes(1);
