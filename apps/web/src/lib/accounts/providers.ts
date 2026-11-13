import {
  type AccountsSnapshot,
  CLAUDE_PROVIDER,
  KNOWN_AGENT_PROVIDERS,
  type ProviderLogin,
  resolvePlanLabel,
} from '@shinsa/core';
import { Option } from 'effect';
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
  const plan = login.status === 'signed_in' ? Option.getOrNull(resolvePlanLabel(login.plan ?? null)) : null;
  return {
    name: resolveAccountProvider(login.provider, login.email ?? null),
    detail: plan ?? resolveTitle(login),
    isDefault: false,
    status: resolveProviderStatus(login, now),
    checkedAt: login.usage?.checkedAt ?? null,
    retryAt: login.usage?.retryAt ?? null,
    reason: login.usage?.detail ?? null,
  };
}

export type ProviderChoice = 'added' | 'removed';

export interface AddableProvider {
  id: string;
  label: string;
}

export function listAddableProviders(snapshot: Pick<AccountsSnapshot, 'providers'>): AddableProvider[] {
  const shown = new Set((snapshot.providers ?? []).map((login) => login.provider));
  return KNOWN_AGENT_PROVIDERS.filter(
    (provider) => provider.id !== CLAUDE_PROVIDER && !shown.has(provider.id)
  ).map(({ id, label }) => ({ id, label }));
}

export function describeProviderRemoval(login: Pick<ProviderLogin, 'label'>) {
  return {
    menu: `Remove ${login.label}`,
    title: `Remove ${login.label} from Shinsa?`,
    body: `Shinsa forgets ${login.label}, and your ${login.label} CLI stays signed in.`,
    action: `Remove ${login.label}`,
    done: `${login.label} removed.`,
  };
}

export function describeProviderAdded(provider: Pick<AddableProvider, 'label'>) {
  return `${provider.label} added.`;
}
