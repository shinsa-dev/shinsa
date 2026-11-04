import { Schema } from 'effect';
import type { Effect } from 'effect';
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

export interface McpOAuthInput {
  readonly redirectUrl: Effect.Effect<string>;
  readonly fetch?: FetchLike | undefined;
}

export type PendingSignIns = ReadonlyMap<string, PendingSignIn>;

export const SIGN_IN_NOT_STARTED = 'The sign-in was not started from this Shinsa.';
