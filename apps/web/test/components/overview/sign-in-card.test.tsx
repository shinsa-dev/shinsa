import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { CLAUDE_PROVIDER, CODEX_PROVIDER, type Gate } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SignInCard } from '@/components/overview/sign-in-card.tsx';
import * as commands from '@/lib/connection/commands.ts';
import { createProviderLogin, createSnapshot } from '../../support/accounts.ts';
import { spyOnToasts } from '../../support/commands.ts';
import {
  listSentCommands,
  pushAccounts,
  pushState,
  startFakeServer,
  stopFakeServer,
} from '../../support/server.ts';
import { createGate, createShinsaState, createTask } from '../../support/state.ts';

const FIX = 'Run `codex login` in a terminal, then refresh.';

let toasts: ReturnType<typeof spyOnToasts>;

beforeEach(() => {
  startFakeServer();
  toasts = spyOnToasts();
  pushAccounts(
    createSnapshot({
      providers: [createProviderLogin({ status: 'signed_out', detail: 'Codex is signed out.', fix: FIX })],
    })
  );
});

afterEach(() => {
  toasts.restore();
  stopFakeServer();
});

function createSignInGate(provider: string | undefined, account: Gate['account'] = null) {
  return createGate({
    id: 'g-sign-in',
    taskId: 't-sign-in',
    type: 'sign_in',
    title: 'Sign in to Codex',
    body: 'Codex says it is signed out.',
    ...(provider ? { provider } : {}),
    account,
  });
}

function renderCard(gate: Gate, props: { onCheck?: () => Promise<unknown>; onSignIn?: () => void } = {}) {
  const task = createTask({ id: 't-sign-in' });
  const state = createShinsaState({ tasks: [task], gates: [gate] });
  pushState(state);
  return render(
    <TooltipProvider>
      <SignInCard state={state} task={task} gate={gate} {...props} />
    </TooltipProvider>
  );
}

describe('the Codex sign-in card', () => {
  const gate = createSignInGate(CODEX_PROVIDER);

  it('checks the Codex sign-in again and stays busy until the check is back', async () => {
    const check = Promise.withResolvers<boolean>();
    const onCheck = mock(() => check.promise);
    renderCard(gate, { onCheck });
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
    const button = screen.getByRole('button', { name: 'Check the Codex sign-in again' });
    expect(button.getAttribute('aria-busy')).toBeNull();
    fireEvent.click(button);
    expect(onCheck).toHaveBeenCalled();
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /Check the Codex sign-in again/ }).getAttribute('aria-busy')
      ).toBe('true');
    });
    await act(async () => {
      check.resolve(true);
      await check.promise;
    });
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /Check the Codex sign-in again/ }).getAttribute('aria-busy')
      ).toBeNull();
    });
  });

  it('shows the fix with a copy button for its command', async () => {
    const copied = spyOn(commands, 'copyText').mockResolvedValue(true);
    try {
      renderCard(gate);
      expect(screen.getByText('Codex says it is signed out.')).toBeDefined();
      expect(screen.getByText('codex login')).toBeDefined();
      expect(screen.getByText(/in a terminal, then refresh\./)).toBeDefined();
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
      expect(await screen.findByRole('button', { name: 'Copied' })).toBeDefined();
      expect(copied).toHaveBeenCalledWith('codex login');
    } finally {
      copied.mockRestore();
    }
  });

  it('retries anyway or cancels the task', async () => {
    renderCard(gate);
    fireEvent.click(screen.getByRole('button', { name: 'Retry anyway' }));
    await waitFor(() => {
      expect(listSentCommands()).toEqual([
        { type: 'gate.answer', gateId: 'g-sign-in', decision: 'approve', response: null },
      ]);
    });
    await waitFor(() => {
      expect((screen.getByRole('button', { name: 'Cancel task' }) as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel task' }));
    await waitFor(() => {
      expect(listSentCommands()).toEqual([
        { type: 'gate.answer', gateId: 'g-sign-in', decision: 'approve', response: null },
        { type: 'gate.answer', gateId: 'g-sign-in', decision: 'reject', response: null },
      ]);
    });
  });
});

describe('the Claude sign-in card', () => {
  it('offers the plain sign-in for a Claude account, whose sign-in Shinsa runs', () => {
    const onSignIn = mock();
    renderCard(createSignInGate(CLAUDE_PROVIDER, { id: 'work', email: 'me@example.com' }), { onSignIn });
    expect(screen.queryByRole('button', { name: 'Check the Codex sign-in again' })).toBeNull();
    expect(screen.queryByText('codex login')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(onSignIn).toHaveBeenCalled();
  });
});
