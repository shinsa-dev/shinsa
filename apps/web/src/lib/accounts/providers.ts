import { type ProviderLogin, resolvePlanLabel } from '@shinsa/core';
import { resolveAccountProvider } from '@/lib/accounts/account.ts';
import { resolveProviderStatus, type UsageAccountHeader } from '@/lib/accounts/usage.ts';

export interface ProviderLoginView {
  title: string;
  fix: string | null;
  command: string | null;
}

const COMMAND = /`([^`]+)`/;

const SIGN_IN_COMMAND: Record<string, string> = { codex: 'codex login' };

function resolveTitle(login: ProviderLogin) {
  switch (login.status) {
    case 'signed_in':
      return login.method ? `Signed in with ${login.method}` : 'Signed in';
    case 'signed_out':
      return 'Not signed in';
    case 'not_installed':
      return 'Not installed';
    case 'outdated':
      return 'Too old for Shinsa';
    case 'unknown':
      return 'Could not check the sign-in';
  }
}

export function describeProviderLogin(login: ProviderLogin): ProviderLoginView {
  const fix = login.fix ?? (login.status === 'outdated' ? login.detail : null);
  return {
    title: resolveTitle(login),
    fix,
    command: (fix && COMMAND.exec(fix)?.[1]) ?? null,
  };
}

export function describeProviderRefresh(login: ProviderLogin) {
  return `Check the ${login.label} sign-in again`;
}

export function selectSignInCommand(login: ProviderLogin) {
  if (login.status !== 'signed_in') return null;
  return SIGN_IN_COMMAND[login.provider] ?? null;
}

export function resolveProviderHeader(login: ProviderLogin, now: number): UsageAccountHeader {
  const plan = login.status === 'signed_in' ? resolvePlanLabel(login.plan ?? null) : null;
  return {
    name: resolveAccountProvider(login.provider, login.email ?? null),
    detail: plan ?? resolveTitle(login),
    isDefault: false,
    status: resolveProviderStatus(login, now),
    checkedAt: login.usage?.checkedAt ?? null,
  };
}
