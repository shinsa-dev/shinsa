import type { RunFailure } from '@shinsa/core';
import type { StoredAccount } from '../schema.ts';

const TOKEN_FAILURE_CODES: ReadonlySet<string> = new Set([
  'login_required',
  'authentication_failed',
  'api_error_401',
]);

export function isTokenFailure(failure: RunFailure) {
  return failure.class === 'auth' && TOKEN_FAILURE_CODES.has(failure.code ?? '');
}

function listEmails(accounts: StoredAccount[]) {
  const emails = accounts.map((account) => account.email ?? 'an account without an email');
  if (emails.length < 2) return emails.join('');
  return `${emails.slice(0, -1).join(', ')} and ${emails.at(-1)}`;
}

function describeSignIn(account: StoredAccount) {
  if (account.origin === 'login') return 'Sign in to it here.';
  return 'Sign in to it here, so Shinsa has a login of its own.';
}

export function describeExpiredLogin(account: StoredAccount, others: StoredAccount[]) {
  const email = account.email ?? 'this account';
  const verb = others.length === 1 ? 'needs' : 'need';
  const also = others.length > 0 ? `, and ${listEmails(others)} ${verb} signing in again too` : '';
  return `Claude could not refresh the login of ${email}${also}. ${describeSignIn(account)}`;
}
