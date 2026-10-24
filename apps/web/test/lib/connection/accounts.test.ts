import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import {
  bindTaskAccount,
  closeSignIn,
  importAccount,
  refreshUsage,
  removeAccount,
  rerunStep,
  resumeUsageWaitNow,
  retrySignIn,
  startSignIn,
  submitLoginCode,
  updateAccount,
  updateUsageWait,
  useAccounts,
  useSignInDialog,
} from '@/lib/connection/accounts.ts';
import { connection } from '@/lib/connection/socket.ts';
import { createAccount, createLogin, createSnapshot } from '../../support/accounts.ts';
import { spyOnCommands, spyOnToasts } from '../../support/commands.ts';
import { startFakeOnboarding } from '../../support/onboarding.ts';
import { pushAccounts, startFakeServer, stopFakeServer } from '../../support/server.ts';

let fake: ReturnType<typeof startFakeOnboarding> | null = null;

let toasts: ReturnType<typeof spyOnToasts>;

const ACCOUNTS = createSnapshot({ accounts: [createAccount({ id: 'a', isDefault: true })] });

const REFUSED = {
  status: 400,
  answer: { error: { code: 'login_running', message: 'A sign-in is already running.' } },
};

beforeEach(() => {
  toasts = spyOnToasts();
  startFakeServer();
});

afterEach(() => {
  act(() => closeSignIn());
  fake?.stop();
  fake = null;
  toasts.restore();
  stopFakeServer();
});

function requestsTo(path: string) {
  return (fake?.requests ?? []).filter((request) => request.path === path).map((request) => request.body);
}

describe('the accounts snapshot', () => {
  it('follows what the server pushes and what every change answers', async () => {
    const { result } = renderHook(() => useAccounts());
    pushAccounts(ACCOUNTS);
    expect(result.current).toEqual(ACCOUNTS);
    const refreshed = createSnapshot({ accounts: [createAccount({ id: 'b' })] });
    fake = startFakeOnboarding({ 'POST /api/accounts/refresh': { answer: refreshed } });
    await act(async () => {
      expect(await refreshUsage()).toBe(true);
    });
    expect(result.current).toEqual(refreshed);
    expect(requestsTo('/api/accounts/refresh')).toEqual([{}]);
  });

  it('keeps the snapshot and shows the reason when the server refuses a change', async () => {
    pushAccounts(ACCOUNTS);
    fake = startFakeOnboarding({ 'POST /api/accounts/remove': REFUSED });
    expect(await removeAccount('a')).toBe(false);
    expect(connection.selectAccounts()).toEqual(ACCOUNTS);
    expect(toasts.error).toHaveBeenCalledWith('A sign-in is already running.');
  });
});

describe('a failed request', () => {
  it('says which status came back when the server gives no reason', async () => {
    fake = startFakeOnboarding({});
    expect(await refreshUsage()).toBe(false);
    expect(toasts.error).toHaveBeenCalledWith('Shinsa answered with status 404.');
  });
});

describe('account changes', () => {
  it('sends each change and confirms it', async () => {
    fake = startFakeOnboarding({
      'POST /api/accounts/import': { answer: ACCOUNTS },
      'POST /api/accounts/update': { answer: ACCOUNTS },
      'POST /api/accounts/remove': { answer: ACCOUNTS },
      'POST /api/accounts/login/code': { answer: ACCOUNTS },
    });
    await importAccount({ origin: 'cswap', email: 'two@example.com', plan: 'pro' });
    await updateAccount('a', { paused: true }, 'Paused.');
    await removeAccount('a');
    await submitLoginCode('login-1', 'abc');
    expect(fake.requests.map((request) => [request.path, request.body])).toEqual([
      ['/api/accounts/import', { origin: 'cswap', email: 'two@example.com' }],
      ['/api/accounts/update', { accountId: 'a', patch: { paused: true } }],
      ['/api/accounts/remove', { accountId: 'a' }],
      ['/api/accounts/login/code', { loginId: 'login-1', code: 'abc' }],
    ]);
    expect(toasts.success.mock.calls.map(([text]) => text)).toEqual([
      'Imported two@example.com.',
      'Paused.',
      'Account removed.',
    ]);
    expect(toasts.success.mock.calls[0]?.[1]).toEqual({
      description:
        'Remove it from claude-swap or turn off claude-swap’s auto-switch, so only Shinsa refreshes this login.',
    });
  });

  it('adds your Claude Code login with a plain confirmation, and says why an import failed', async () => {
    fake = startFakeOnboarding({ 'POST /api/accounts/import': { answer: ACCOUNTS } });
    expect(await importAccount({ origin: 'claude', email: 'me@example.com', plan: 'max' })).toBe(true);
    expect(toasts.success).toHaveBeenCalledWith('Added your Claude Code login.');
    fake?.stop();
    fake = startFakeOnboarding({ 'POST /api/accounts/import': REFUSED });
    expect(await importAccount({ origin: 'cswap', email: 'x@example.com', plan: null })).toBe(false);
    expect(toasts.error).toHaveBeenCalledWith('A sign-in is already running.');
  });

  it('binds tasks and changes their usage waits through commands', async () => {
    const spies = spyOnCommands();
    await bindTaskAccount('t', { id: 'a', email: 'a@example.com' });
    await bindTaskAccount('t', null);
    await resumeUsageWaitNow('t');
    await updateUsageWait('t', false);
    await rerunStep('t', { id: 'a', email: 'a@example.com' });
    expect(spies.sent.mock.calls).toEqual([
      [
        { type: 'task.bind_account', taskId: 't', account: { id: 'a', email: 'a@example.com' } },
        'Runs on a@example.com.',
      ],
      [{ type: 'task.bind_account', taskId: 't', account: null }, 'Runs on any account.'],
      [{ type: 'usage_wait.resume_now', taskId: 't' }, 'Resuming now.'],
      [{ type: 'usage_wait.change', taskId: 't', autoResume: false }, 'Waits for you at the reset.'],
      [
        { type: 'task.retry', taskId: 't', account: { id: 'a', email: 'a@example.com' } },
        'Running this step again on a@example.com.',
      ],
    ] as never);
    spies.restore();
  });
});

describe('signing in', () => {
  it('opens the dialog, follows the sign-in it started and signs in an existing account', async () => {
    const started = createSnapshot({ login: createLogin({ accountId: 'a' }) });
    fake = startFakeOnboarding({ 'POST /api/accounts/login': { answer: started } });
    const { result } = renderHook(() => useSignInDialog());
    await act(() => startSignIn('a'));
    expect(result.current).toEqual({ open: true, accountId: 'a', loginId: 'login-1', failure: null });
    expect(requestsTo('/api/accounts/login')).toEqual([{ accountId: 'a' }]);
    await act(() => retrySignIn());
    expect(requestsTo('/api/accounts/login')).toEqual([{ accountId: 'a' }, { accountId: 'a' }]);
  });

  it('starts a sign-in for a new account and remembers why it could not start', async () => {
    fake = startFakeOnboarding({ 'POST /api/accounts/login': REFUSED });
    const { result } = renderHook(() => useSignInDialog());
    await act(() => startSignIn());
    expect(requestsTo('/api/accounts/login')).toEqual([{}]);
    expect(result.current).toMatchObject({
      open: true,
      loginId: null,
      failure: 'A sign-in is already running.',
    });
  });

  it('cancels a sign-in that is still running when the dialog closes', async () => {
    fake = startFakeOnboarding({
      'POST /api/accounts/login': { answer: createSnapshot({ login: createLogin() }) },
      'POST /api/accounts/login/cancel': { answer: createSnapshot() },
    });
    await act(() => startSignIn());
    act(() => closeSignIn());
    await act(() => Promise.resolve());
    expect(requestsTo('/api/accounts/login/cancel')).toEqual([{ loginId: 'login-1' }]);
  });

  it('clears a finished sign-in when the dialog closes', async () => {
    fake = startFakeOnboarding({
      'POST /api/accounts/login': { answer: createSnapshot({ login: createLogin({ phase: 'done' }) }) },
      'POST /api/accounts/login/cancel': { answer: createSnapshot() },
    });
    await act(() => startSignIn());
    act(() => closeSignIn());
    await act(() => Promise.resolve());
    expect(requestsTo('/api/accounts/login/cancel')).toEqual([{ loginId: 'login-1' }]);
  });

  it('starts a new account when the started one had no login to follow', async () => {
    fake = startFakeOnboarding({ 'POST /api/accounts/login': { answer: createSnapshot() } });
    const { result } = renderHook(() => useSignInDialog());
    await act(() => startSignIn());
    expect(result.current.loginId).toBeNull();
  });
});
