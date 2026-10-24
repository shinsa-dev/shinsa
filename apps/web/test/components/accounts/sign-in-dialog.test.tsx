import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { AccountsSnapshot } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SignInDialog } from '@/components/accounts/sign-in-dialog.tsx';
import { closeSignIn, startSignIn, useSignInDialog } from '@/lib/connection/accounts.ts';
import { createLogin, createSnapshot } from '../../support/accounts.ts';
import { spyOnToasts } from '../../support/commands.ts';
import { startFakeOnboarding } from '../../support/onboarding.ts';
import { pushAccounts, startFakeServer, stopFakeServer } from '../../support/server.ts';
import { waitForGone } from '../../support/wait.ts';

let fake: ReturnType<typeof startFakeOnboarding> | null = null;

let toasts: ReturnType<typeof spyOnToasts>;

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

function OpenState() {
  return <output aria-label='Open'>{String(useSignInDialog().open)}</output>;
}

async function settle() {
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

async function openDialog(started: AccountsSnapshot, routes: Parameters<typeof startFakeOnboarding>[0] = {}) {
  fake = startFakeOnboarding({ 'POST /api/accounts/login': { answer: started }, ...routes });
  render(
    <TooltipProvider>
      <SignInDialog />
      <OpenState />
    </TooltipProvider>
  );
  await act(() => startSignIn('a'));
  await settle();
}

describe('the sign-in dialog', () => {
  it('shows the sign-in page link and sends the code you paste', async () => {
    await openDialog(createSnapshot({ login: createLogin() }), {
      'POST /api/accounts/login/code': {
        answer: createSnapshot({ login: createLogin({ phase: 'finishing' }) }),
      },
    });
    expect(screen.getByText('Sign in to Claude')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'open the sign-in page' }).getAttribute('href')).toBe(
      'https://claude.ai/oauth/authorize?code=abc'
    );
    const field = screen.getByRole('textbox', { name: 'Sign-in code' });
    fireEvent.change(field, { target: { value: ' abc-123 ' } });
    await act(async () => {
      fireEvent.submit(field.closest('form') as HTMLFormElement);
    });
    await settle();
    expect(fake?.requests.at(-1)).toMatchObject({
      path: '/api/accounts/login/code',
      body: { loginId: 'login-1', code: 'abc-123' },
    });
    expect(screen.getByText('Finishing sign-in…')).toBeTruthy();
  });

  it('keeps the code when the server refuses it', async () => {
    await openDialog(createSnapshot({ login: createLogin({ url: null }) }), {
      'POST /api/accounts/login/code': { status: 400, answer: { error: { message: 'That code expired.' } } },
    });
    expect(
      screen.getByText(/^A browser window opened to sign in to Claude\. If the page shows a code/)
    ).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
    const field = screen.getByRole('textbox', { name: 'Sign-in code' });
    fireEvent.change(field, { target: { value: 'old' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Submit code' }));
    });
    await settle();
    expect(toasts.error).toHaveBeenCalledWith('That code expired.');
    expect((field as HTMLInputElement).value).toBe('old');
  });

  it('starts with a spinner and says who signed in at the end', async () => {
    await openDialog(createSnapshot({ login: createLogin({ phase: 'starting' }) }));
    expect(screen.getByText('Starting sign-in…')).toBeTruthy();
    pushAccounts(createSnapshot({ login: createLogin({ phase: 'done', email: 'me@example.com' }) }));
    expect(screen.getByText('Signed in as me@example.com.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await settle();
    expect(screen.getByRole('status', { name: 'Open' }).textContent).toBe('false');
  });

  it('says why a sign-in failed and tries again', async () => {
    await openDialog(
      createSnapshot({ login: createLogin({ phase: 'failed', message: 'Claude closed early.' }) })
    );
    expect(screen.getByText('The sign-in did not finish')).toBeTruthy();
    expect(screen.getByText('Claude closed early.')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    });
    expect(fake?.requests.filter((request) => request.path === '/api/accounts/login')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await settle();
    expect(screen.getByRole('status', { name: 'Open' }).textContent).toBe('false');
  });

  it('keeps the step it was on while it closes after Cancel', async () => {
    await openDialog(createSnapshot({ login: createLogin() }), {
      'POST /api/accounts/login/cancel': { answer: createSnapshot() },
    });
    const field = screen.getByRole('textbox', { name: 'Sign-in code' }) as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('status', { name: 'Open' }).textContent).toBe('false');
    expect(screen.getByText('Sign in to Claude')).toBeTruthy();
    expect(screen.queryByText('Starting sign-in…')).toBeNull();
    expect(field.value).toBe('abc');
    await settle();
    await waitForGone(() => screen.queryByText('Sign in to Claude'));
    expect(screen.queryByText('Starting sign-in…')).toBeNull();
  });

  it('cancels a running sign-in from the dialog’s Cancel', async () => {
    await openDialog(createSnapshot({ login: createLogin() }), {
      'POST /api/accounts/login/cancel': { answer: createSnapshot() },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await settle();
    await waitFor(() =>
      expect(fake?.requests.at(-1)).toMatchObject({
        path: '/api/accounts/login/cancel',
        body: { loginId: 'login-1' },
      })
    );
  });
});
