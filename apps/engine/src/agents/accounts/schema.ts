import type {
  AccountSwitchReason,
  ChatEvent,
  FastModeAvailability,
  Run,
  RunAccount,
  RunFailure,
  ShinsaState,
  WeeklyReading,
} from '@shinsa/core';
import { type Effect, Schema } from 'effect';

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

export type RejectionHandler = (rejection: RunRejection) => Promise<RejectionVerdict> | RejectionVerdict;

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

export interface AccountBroker {
  lease: (request: AccountLeaseRequest) => Promise<AccountLease | null>;
  readWeeklyReading: (accountId: string, force: boolean) => Promise<WeeklyReading | null>;
  readProviderWeeklyReading: (provider: string, force: boolean) => Promise<WeeklyReading | null>;
  readFastMode: (provider: string, accountId: string | null) => Promise<FastModeAvailability>;
}

export class AccountBrokerFailed extends Schema.TaggedError<
  AccountBrokerFailed,
  { readonly brand: unique symbol }
>()('AccountBrokerFailed', { message: Schema.String }) {}

export class RejectionHandlerFailed extends Schema.TaggedError<
  RejectionHandlerFailed,
  { readonly brand: unique symbol }
>()('RejectionHandlerFailed', { message: Schema.String }) {}

interface LeasingBroker {
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

export interface AccountLeasingDefinition {
  readonly broker: LeasingBroker | null;
  readonly state: Effect.Effect<ShinsaState>;
  readonly record: (runId: string, event: ChatEvent) => Effect.Effect<void>;
}

export interface AccountLeasingHandle {
  readonly leaseAttempt: (
    run: Run,
    exclude: string[],
    renewed: RunAccount | null
  ) => Effect.Effect<AccountLease | null, AccountBrokerFailed>;
  readonly readWeeklyReading: (
    runId: string,
    lease: AccountLease | null,
    provider: string,
    force: boolean
  ) => Effect.Effect<WeeklyReading | null>;
  readonly readFastMode: (
    lease: AccountLease | null,
    provider: string
  ) => Effect.Effect<FastModeAvailability, AccountBrokerFailed>;
  readonly leaseSession: (run: Run) => Effect.Effect<AccountLease | null, AccountBrokerFailed> | null;
}
