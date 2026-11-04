import type { StoredAccount } from '../schema.ts';

export interface RenewedLogin {
  readonly account: StoredAccount;
  readonly fingerprint: string;
}
