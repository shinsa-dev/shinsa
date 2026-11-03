import type {
  DomainError,
  ExtensionPlace,
  ExtensionsSnapshot,
  ExtensionUsageRead,
  LoadedExtensions,
  McpServerStatus,
  ShinsaState,
} from '@shinsa/core';
import { Schema } from 'effect';
import type { Effect } from 'effect';
import type { ServerConfig } from '../../config/index.ts';
import type { SecretStore } from '../../secrets/store.ts';
import type { ServerCheck } from '../health.ts';
import type { OpenClient } from '../loader/schema.ts';
import type { FetchLike, McpSignInFailed } from '../oauth/schema.ts';
import type { Env, McpCheckedStatus, McpDefinition } from '../schema.ts';
import type { SessionExtensions } from '../session.ts';
import type { ExtensionStore } from '../store.ts';
import type { UsageIndex } from '../usage.ts';

type ExtensionsConfig = Pick<ServerConfig, 'home' | 'userHome' | 'pluginDir'> &
  Partial<Pick<ServerConfig, 'dataDir' | 'transcriptsDir'>>;

export interface ExtensionsOptions {
  state: () => ShinsaState;
  config: ExtensionsConfig;
  secrets: SecretStore;
  baseUrl: () => string;
  env?: Env;
  check?: ServerCheck;
  now?: () => number;
  fetch?: FetchLike;
  usage?: UsageIndex;
  open?: OpenClient;
}

export class ServerCheckFailed extends Schema.TaggedError<
  ServerCheckFailed,
  { readonly brand: unique symbol }
>()('ServerCheckFailed', { message: Schema.String }) {}

export class UsageReadFailed extends Schema.TaggedError<UsageReadFailed, { readonly brand: unique symbol }>()(
  'UsageReadFailed',
  { message: Schema.String }
) {}

export class SnapshotRefreshFailed extends Schema.TaggedError<
  SnapshotRefreshFailed,
  { readonly brand: unique symbol }
>()('SnapshotRefreshFailed', { message: Schema.String }) {}

export interface UsageView {
  readonly read: ExtensionUsageRead;
  readonly selectServer: (runtimeName: string) => number | null;
  readonly selectSkill: (name: string) => number | null;
}

interface ExtensionsUsage {
  readonly view: Effect.Effect<UsageView>;
  readonly isStale: (maxAgeMs: number) => Effect.Effect<boolean>;
  readonly refresh: Effect.Effect<void, UsageReadFailed>;
  readonly stop: Effect.Effect<void>;
}

export interface ExtensionsDefinition {
  readonly state: Effect.Effect<ShinsaState>;
  readonly config: ExtensionsConfig;
  readonly env: Env;
  readonly secrets: SecretStore;
  readonly store: ExtensionStore;
  readonly usage: ExtensionsUsage;
  readonly redirectUrl: Effect.Effect<string>;
  readonly now: Effect.Effect<number>;
  readonly random: Effect.Effect<string>;
  readonly fetch: FetchLike | undefined;
  readonly check: ((definition: McpDefinition) => Effect.Effect<McpCheckedStatus, ServerCheckFailed>) | null;
  readonly refresh: Effect.Effect<void, SnapshotRefreshFailed>;
}

interface SignInStart {
  authorizationUrl: string | null;
  snapshot: ExtensionsSnapshot;
}

export interface ExtensionsHandle {
  readonly syncUsage: Effect.Effect<void>;
  readonly stop: Effect.Effect<void>;
  readonly readSnapshot: Effect.Effect<ExtensionsSnapshot>;
  readonly syncSnapshot: Effect.Effect<void>;
  readonly snapshot: Effect.Effect<ExtensionsSnapshot>;
  readonly createServer: (fields: unknown) => Effect.Effect<ExtensionsSnapshot, DomainError>;
  readonly updateServer: (id: unknown, fields: unknown) => Effect.Effect<ExtensionsSnapshot, DomainError>;
  readonly removeServer: (id: unknown) => Effect.Effect<ExtensionsSnapshot, DomainError>;
  readonly updateServerChoice: (
    id: unknown,
    fields: unknown
  ) => Effect.Effect<ExtensionsSnapshot, DomainError>;
  readonly updateSkillChoice: (
    id: unknown,
    enabled: unknown
  ) => Effect.Effect<ExtensionsSnapshot, DomainError>;
  readonly updatePluginChoice: (
    id: unknown,
    enabled: unknown
  ) => Effect.Effect<ExtensionsSnapshot, DomainError>;
  readonly updateOptimizer: (fields: unknown) => Effect.Effect<ExtensionsSnapshot, DomainError>;
  readonly check: (id?: unknown) => Effect.Effect<ExtensionsSnapshot, DomainError | ServerCheckFailed>;
  readonly startSignIn: (
    id: unknown
  ) => Effect.Effect<SignInStart, DomainError | McpSignInFailed | ServerCheckFailed>;
  readonly finishSignIn: (url: URL) => Effect.Effect<string>;
  readonly signOut: (id: unknown) => Effect.Effect<ExtensionsSnapshot, DomainError>;
  readonly resolveSession: (
    place: ExtensionPlace,
    pin: LoadedExtensions | null
  ) => Effect.Effect<SessionExtensions>;
}

export const UNCHECKED_STATUS: McpServerStatus = {
  state: 'unchecked',
  error: null,
  checkedAt: null,
  tools: [],
  tokens: null,
};

export const SEEN_BEFORE_WATCHING = 0;
