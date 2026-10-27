import type { AccountImport, AccountSummary } from '@shinsa/core';

export interface ClaudeAccount {
  id: string;
  email: string | null;
  signedIn: boolean;
}

export type AccountSource = () => Promise<ClaudeAccount[]>;

export interface AccountActions {
  listImports: () => Promise<AccountImport[]>;
  importAccount: (origin: AccountImport['origin'], email: string) => Promise<void>;
}

export function createSummaryAccountSource(list: () => AccountSummary[]): AccountSource {
  return () =>
    Promise.resolve(
      list().map((account) => ({
        id: account.id,
        email: account.email,
        signedIn: account.signIn === 'signed_in',
      }))
    );
}
