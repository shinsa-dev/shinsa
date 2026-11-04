import type { AccountIdentity, StoredAccount } from '../schema.ts';

export function isSameIdentity(a: AccountIdentity, b: AccountIdentity) {
  if (!a.email || !b.email || a.email.toLowerCase() !== b.email.toLowerCase()) return false;
  if (!a.organization || !b.organization) return true;
  return a.organization.toLowerCase() === b.organization.toLowerCase();
}

export function isSharedLogin(account: StoredAccount) {
  return account.origin !== 'login';
}
