import type { AccountUsage, ChatNotice } from '@shinsa/core';
import { Schema } from 'effect';
import type { Effect } from 'effect';
import type { KeyedWindow, UsageRead } from '../schema.ts';

export type UsageReader = (accountId: string) => Promise<UsageRead>;

export interface UsageLimitsOptions {
  path: string;
  read: UsageReader;
  ttlMs?: number;
  now?: () => number;
  windows?: Record<string, KeyedWindow>;
  emptyDetail?: string;
}

export type RateLimitNotice = Extract<ChatNotice, { kind: 'rate_limit' }>;

export const NO_WINDOWS = 'Claude reports no usage limits for this account.';

export class UsageReaderFailed extends Schema.TaggedError<
  UsageReaderFailed,
  { readonly brand: unique symbol }
>()('UsageReaderFailed', { message: Schema.String }) {}

export interface UsageLimitsDefinition {
  readonly path: string;
  readonly read: (accountId: string) => Effect.Effect<UsageRead, UsageReaderFailed>;
  readonly ttlMs: number;
  readonly now: Effect.Effect<number>;
  readonly windows: Record<string, KeyedWindow>;
  readonly emptyDetail: string;
  readonly changed: Effect.Effect<void>;
}

export interface UsageLimitsHandle {
  readonly snapshot: (accountId: string) => Effect.Effect<AccountUsage>;
  readonly isFresh: (accountId: string) => Effect.Effect<boolean>;
  readonly refresh: (accountIds: readonly string[], force: boolean) => Effect.Effect<void>;
  readonly remove: (accountId: string) => Effect.Effect<void>;
  readonly recordPush: (accountId: string, notice: RateLimitNotice) => Effect.Effect<void>;
}
