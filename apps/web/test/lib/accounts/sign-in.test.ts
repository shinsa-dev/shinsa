import { describe, expect, it } from 'bun:test';
import {
  describeSignedIn,
  describeSignInCheck,
  LOGIN_TITLE,
  resolveLoginView,
  resolveSignInProvider,
  type SignInDialogState,
  selectDialogLogin,
  selectSignInLogin,
} from '@/lib/accounts/sign-in.ts';
import { createLogin, createProviderLogin, createSnapshot } from '../../support/accounts.ts';

function dialog(overrides: Partial<SignInDialogState> = {}): SignInDialogState {
  return { open: true, accountId: null, importing: null, loginId: 'login-1', failure: null, ...overrides };
}

describe('the sign-in dialog', () => {
  it('follows only the sign-in it started', () => {
    const snapshot = createSnapshot({ login: createLogin() });
    expect(selectDialogLogin(dialog(), snapshot)?.id).toBe('login-1');
    expect(selectDialogLogin(dialog({ loginId: 'other' }), snapshot)).toBeNull();
    expect(selectDialogLogin(dialog({ loginId: null }), snapshot)).toBeNull();
    expect(selectDialogLogin(dialog(), createSnapshot())).toBeNull();
    expect(selectDialogLogin(dialog(), null)).toBeNull();
  });

  it('shows each phase of the sign-in', () => {
    const at = (login: ReturnType<typeof createLogin>) =>
      resolveLoginView(dialog(), createSnapshot({ login }));
    expect(resolveLoginView(dialog({ loginId: null }), null)).toEqual({ phase: 'starting' });
    expect(at(createLogin({ phase: 'starting' }))).toEqual({ phase: 'starting' });
    expect(at(createLogin())).toEqual({
      phase: 'waiting',
      loginId: 'login-1',
      url: 'https://claude.ai/oauth/authorize?code=abc',
    });
    expect(at(createLogin({ phase: 'finishing' }))).toEqual({ phase: 'finishing' });
    expect(at(createLogin({ phase: 'done', email: 'me@example.com' }))).toEqual({
      phase: 'done',
      email: 'me@example.com',
    });
    expect(at(createLogin({ phase: 'failed', message: 'The code expired.' }))).toEqual({
      phase: 'failed',
      message: 'The code expired.',
    });
    expect(at(createLogin({ phase: 'failed' }))).toEqual({
      phase: 'failed',
      message: 'Claude stopped the sign-in without saying why.',
    });
    expect(resolveLoginView(dialog({ failure: 'Claude is not installed.' }), null)).toEqual({
      phase: 'failed',
      message: 'Claude is not installed.',
    });
  });

  it('titles every phase and confirms who signed in', () => {
    expect(LOGIN_TITLE.starting).toBe('Starting sign-in…');
    expect(describeSignedIn('me@example.com')).toBe('Signed in as me@example.com.');
    expect(describeSignedIn(null)).toBe('Signed in to Claude.');
  });
});

describe('a sign-in a provider owns', () => {
  it('is the provider the gate names, unless it is Claude, whose accounts Shinsa signs in itself', () => {
    expect(resolveSignInProvider({ provider: 'codex' })).toBe('codex');
    expect(resolveSignInProvider({ provider: 'gemini' })).toBe('gemini');
    expect(resolveSignInProvider({ provider: 'claude' })).toBeNull();
    expect(describeSignInCheck('codex')).toBe('Check the Codex sign-in again');
  });

  it('reads that provider’s own sign-in from the snapshot', () => {
    const codex = createProviderLogin({ status: 'signed_out' });
    expect(selectSignInLogin(createSnapshot({ providers: [codex] }), 'codex')).toBe(codex);
    expect(selectSignInLogin(createSnapshot(), 'codex')).toBeNull();
    expect(selectSignInLogin(null, 'codex')).toBeNull();
  });
});
