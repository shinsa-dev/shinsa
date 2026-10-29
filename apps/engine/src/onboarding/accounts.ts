import type { AccountSummary } from '@shinsa/core';

export interface ClaudeAccount {
  id: string;
  email: string | null;
  signedIn: boolean;
}

export type AccountSource = () => Promise<ClaudeAccount[]>;

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
