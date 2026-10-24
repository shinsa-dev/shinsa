import {
  type AccountsSnapshot,
  CLAUDE_PROVIDER,
  type Gate,
  KNOWN_AGENT_PROVIDERS,
  type ProviderLogin,
  resolveProviderLabel,
} from '@shinsa/core';

export interface SignInDialogState {
  open: boolean;
  accountId: string | null;
  loginId: string | null;
  failure: string | null;
}

export type LoginView =
  | { phase: 'starting' | 'finishing' }
  | { phase: 'waiting'; loginId: string; url: string | null }
  | { phase: 'done'; email: string | null }
  | { phase: 'failed'; message: string };

export function selectDialogLogin(dialog: SignInDialogState, snapshot: AccountsSnapshot | null) {
  const login = snapshot?.login ?? null;
  return login && dialog.loginId !== null && login.id === dialog.loginId ? login : null;
}

export function resolveLoginView(dialog: SignInDialogState, snapshot: AccountsSnapshot | null): LoginView {
  if (dialog.failure !== null) return { phase: 'failed', message: dialog.failure };
  const login = selectDialogLogin(dialog, snapshot);
  if (!login || login.phase === 'starting') return { phase: 'starting' };
  if (login.phase === 'waiting') return { phase: 'waiting', loginId: login.id, url: login.url };
  if (login.phase === 'finishing') return { phase: 'finishing' };
  if (login.phase === 'done') return { phase: 'done', email: login.email };
  return { phase: 'failed', message: login.message ?? 'Claude stopped the sign-in without saying why.' };
}

export const LOGIN_TITLE: Record<LoginView['phase'], string> = {
  starting: 'Starting sign-in…',
  waiting: 'Sign in to Claude',
  finishing: 'Finishing sign-in…',
  done: 'Signed in',
  failed: 'The sign-in did not finish',
};

export function describeSignedIn(email: string | null) {
  return email ? `Signed in as ${email}.` : 'Signed in to Claude.';
}

export function resolveSignInProvider(gate: Pick<Gate, 'account'>) {
  const id = gate.account?.id ?? null;
  if (id === null || id === CLAUDE_PROVIDER) return null;
  return KNOWN_AGENT_PROVIDERS.some((provider) => provider.id === id) ? id : null;
}

export function selectSignInLogin(snapshot: AccountsSnapshot | null, provider: string): ProviderLogin | null {
  return snapshot?.providers?.find((login) => login.provider === provider) ?? null;
}

export function describeSignInCheck(provider: string) {
  return `Check the ${resolveProviderLabel(provider)} sign-in again`;
}
