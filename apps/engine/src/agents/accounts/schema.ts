import type {
  AccountSwitchReason,
  FastModeAvailability,
  RunAccount,
  RunFailure,
  WeeklyReading,
} from '@shinsa/core';
import { Context, type Effect, Schema } from 'effect';

export interface RunRejection {
  runId: string;
  taskId: string;
  provider: string;
  attemptId: string;
  accountId: string | null;
  tried: string[];
  renewed: string[];
  failure: RunFailure;
}

export interface RejectionVerdict {
  retry: boolean;
  failure?: RunFailure;
  renewed?: string;
}

export type RejectionHandler = (rejection: RunRejection) => Effect.Effect<RejectionVerdict>;

export interface AccountLease {
  id: string;
  email: string | null;
  configDir: string | null;
  reason: AccountSwitchReason | null;
}

export interface AccountLeaseRequest {
  runId: string;
  taskId: string;
  model: string | null;
  bound: RunAccount | null;
  previous: RunAccount | null;
  exclude: string[];
}

export class AccountBrokerFailed extends Schema.TaggedError<
  AccountBrokerFailed,
  { readonly brand: unique symbol }
>()('AccountBrokerFailed', { message: Schema.String }) {}

export interface AccountBrokerShape {
  readonly lease: (request: AccountLeaseRequest) => Effect.Effect<AccountLease | null, AccountBrokerFailed>;
  readonly readWeeklyReading: (
    accountId: string,
    force: boolean
  ) => Effect.Effect<WeeklyReading | null, AccountBrokerFailed>;
  readonly readProviderWeeklyReading: (
    provider: string,
    force: boolean
  ) => Effect.Effect<WeeklyReading | null, AccountBrokerFailed>;
  readonly readFastMode: (
    provider: string,
    accountId: string | null
  ) => Effect.Effect<FastModeAvailability, AccountBrokerFailed>;
}

export const AccountBroker = Context.Reference<AccountBrokerShape | null>(
  'shinsa/engine/agents/accounts/AccountBroker',
  { defaultValue: () => null }
);
