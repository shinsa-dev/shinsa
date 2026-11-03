import type { AccountSignIn, ShinsaState } from '@shinsa/core';
import type { Effect } from 'effect';
import type {
  AccountLease,
  AccountLeaseRequest,
  RejectionVerdict,
  RunRejection,
} from '../../agents/index.ts';
import type { SecretReadFailed } from '../credentials/schema.ts';
import type { UsageLimits } from '../limits.ts';
import type { UsageLimitsHandle } from '../limits/schema.ts';
import type { LoginRenewal } from '../renewal.ts';
import type { LoginRenewalHandle } from '../renewal/schema.ts';
import type { StoredAccount } from '../schema.ts';
import type { AccountStore } from '../store.ts';

export interface SignInState {
  signIn: AccountSignIn;
  detail: string | null;
}

export interface AccountRotationOptions {
  store: AccountStore;
  limits: UsageLimits;
  renewal: LoginRenewal;
  signIns: Map<string, SignInState>;
  state: () => ShinsaState;
  now: () => number;
  onChange: () => void;
  marksPath: string;
}

export const MAX_ACCOUNTS_PER_EXECUTION = 3;

interface RotationStore {
  readonly listDistinct: Effect.Effect<StoredAccount[]>;
  readonly resolveDuplicates: Effect.Effect<Map<string, string>>;
  readonly isDefault: (accountId: string, duplicates: Map<string, string>) => Effect.Effect<boolean>;
  readonly select: (accountId: string) => Effect.Effect<StoredAccount | null>;
  readonly find: (accountId: string) => Effect.Effect<StoredAccount>;
  readonly linkSharedEntries: (configDir: string) => Effect.Effect<void>;
}

export interface AccountRotationDefinition {
  readonly store: RotationStore;
  readonly limits: UsageLimitsHandle;
  readonly renewal: LoginRenewalHandle;
  readonly selectSignIn: (accountId: string) => Effect.Effect<AccountSignIn | null>;
  readonly markSignedOut: (accountId: string, detail: string) => Effect.Effect<void>;
  readonly state: Effect.Effect<ShinsaState>;
  readonly now: Effect.Effect<number>;
  readonly changed: Effect.Effect<void>;
  readonly marksPath: string;
}

export interface AccountRotationHandle {
  readonly resolveSpentUntil: (accountId: string, knownResets: boolean) => Effect.Effect<number | null>;
  readonly clear: (accountId: string) => Effect.Effect<void>;
  readonly lease: (request: AccountLeaseRequest) => Effect.Effect<AccountLease | null>;
  readonly recordRejection: (
    rejection: RunRejection
  ) => Effect.Effect<RejectionVerdict | Effect.Effect<RejectionVerdict, SecretReadFailed>>;
}
