import type { DomainError } from '@shinsa/core';
import { Schema } from 'effect';
import type { Effect } from 'effect';
import type { SecretStore } from '../../secrets/store.ts';
import type { PendingSignIn } from '../schema.ts';

export type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>;

export class McpSignInFailed extends Schema.TaggedError<McpSignInFailed, { readonly brand: unique symbol }>()(
  'McpSignInFailed',
  { message: Schema.String }
) {}

export interface ProviderGrant {
  readonly serverId: string;
  readonly redirect: string;
  readonly state: string;
  readonly savedAt: number;
}

export interface McpOAuthDefinition {
  readonly store: SecretStore;
  readonly redirectUrl: Effect.Effect<string>;
  readonly now: Effect.Effect<number>;
  readonly random: Effect.Effect<string>;
  readonly fetch: FetchLike | undefined;
  readonly pendingMs: number;
}

export type PendingSignIns = ReadonlyMap<string, PendingSignIn>;

export interface McpOAuthHandle {
  readonly isSignedIn: (serverId: string) => Effect.Effect<boolean>;
  readonly start: (serverId: string, url: string) => Effect.Effect<string | null, McpSignInFailed>;
  readonly finish: (state: string, code: string) => Effect.Effect<string, McpSignInFailed | DomainError>;
  readonly resolveAccessToken: (serverId: string, url: string) => Effect.Effect<string | null>;
  readonly signOut: (serverId: string) => Effect.Effect<void>;
}
