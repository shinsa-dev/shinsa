import type { AccountUsage, ChatNotice } from '@shinsa/core';
import type { Effect } from 'effect';

export type RateLimitNotice = Extract<ChatNotice, { kind: 'rate_limit' }>;

export const NO_WINDOWS = 'Claude reports no usage limits for this account.';

export const NO_PROVIDER_WINDOWS = 'No usage limits reported for this sign-in.';

export const ACCOUNT_USAGE_FILE = 'usage-limits.json';

export const PROVIDER_USAGE_FILE = 'provider-usage.json';

export const ACCOUNT_READS_FILE = 'usage-reads.json';

export const PROVIDER_READS_FILE = 'provider-usage-reads.json';

export interface UsageTable {
  readonly snapshot: (id: string) => Effect.Effect<AccountUsage>;
  readonly measured: (id: string) => Effect.Effect<AccountUsage>;
  readonly isFresh: (id: string) => Effect.Effect<boolean>;
  readonly refresh: (ids: readonly string[], force: boolean) => Effect.Effect<void>;
  readonly remove: (id: string) => Effect.Effect<void>;
  readonly recordPush: (id: string, notice: RateLimitNotice) => Effect.Effect<void>;
}
