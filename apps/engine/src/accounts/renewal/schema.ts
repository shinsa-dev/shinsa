import type { Effect } from 'effect';
import type { SecretReader } from '../credentials.ts';
import type { SecretLookup, SecretReadFailed } from '../credentials/schema.ts';
import type { Env } from '../paths.ts';
import type { StoredAccount } from '../schema.ts';

export interface LoginRenewalOptions {
  env: Env;
  userHome: string;
  readSecret: SecretReader;
  now: () => number;
}

export interface RenewedLogin {
  account: StoredAccount;
  fingerprint: string;
}

export interface LoginRenewalDefinition {
  readonly env: Env;
  readonly userHome: string;
  readonly readSecret: SecretLookup;
  readonly now: Effect.Effect<number>;
}

export interface LoginRenewalHandle {
  readonly renew: (account: StoredAccount) => Effect.Effect<boolean, SecretReadFailed>;
  readonly recordFailed: (account: StoredAccount) => Effect.Effect<void, SecretReadFailed>;
  readonly clear: (accountId: string) => Effect.Effect<void>;
  readonly listRenewed: (
    accounts: readonly StoredAccount[]
  ) => Effect.Effect<RenewedLogin[], SecretReadFailed>;
}
