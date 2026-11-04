import type { AccountsSnapshot } from '@shinsa/core';
import { Effect } from 'effect';

export interface ClaudeAccount {
  id: string;
  email: string | null;
  signedIn: boolean;
}

export type AccountSource = Effect.Effect<ClaudeAccount[]>;

export function createSummaryAccountSource(snapshot: Effect.Effect<AccountsSnapshot>): AccountSource {
  return Effect.map(snapshot, ({ accounts }) =>
    accounts.map((account) => ({
      id: account.id,
      email: account.email,
      signedIn: account.signIn === 'signed_in',
    }))
  );
}
