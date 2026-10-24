import { type AccountImport, type AccountSummary, resolvePlanLabel } from '@shinsa/core';

export interface ClaudeAccount {
  id: string;
  signedIn: boolean;
  detail: string;
  label?: string;
}

export type AccountSource = () => Promise<ClaudeAccount[]>;

export interface AccountActions {
  listImports: () => Promise<AccountImport[]>;
  importAccount: (origin: AccountImport['origin'], email: string) => Promise<void>;
  startLogin: (accountId: string | null) => Promise<void>;
  isSigningIn: () => boolean;
}

function describeAccount(account: AccountSummary) {
  if (account.signIn === 'signed_out') return 'Needs you to sign in again.';
  if (account.signIn === 'unknown') return account.signInDetail ?? 'Not checked yet.';
  const plan = resolvePlanLabel(account.plan);
  return plan ? `Signed in, ${plan} plan.` : 'Signed in.';
}

export function createSummaryAccountSource(list: () => AccountSummary[]): AccountSource {
  return () =>
    Promise.resolve(
      list().map((account) => ({
        id: account.id,
        signedIn: account.signIn === 'signed_in',
        detail: describeAccount(account),
        label: account.email ?? 'Claude account',
      }))
    );
}
