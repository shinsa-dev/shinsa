import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { createSettings, type RemoteUser } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AccountSettings } from '@/components/settings/accounts.tsx';
import { SharedMachineRow } from '@/components/settings/shared-machine.tsx';
import * as connectionAccounts from '@/lib/connection/accounts.ts';
import { ViewerContext } from '@/lib/remote/viewer.ts';
import { createAccount, createSnapshot } from '../../support/accounts.ts';
import { spyOnToasts } from '../../support/commands.ts';
import { startFakeOnboarding } from '../../support/onboarding.ts';
import {
  listSentCommands,
  pushAccounts,
  pushState,
  startFakeServer,
  stopFakeServer,
} from '../../support/server.ts';
import { createShinsaState } from '../../support/state.ts';

const KAI: RemoteUser = { id: 'u-kai', login: 'kai', name: 'Kai Lane', avatarUrl: null };

const TOKEN = { login: 'kai', saved: false, savedAt: null, machineLogin: false };

let toasts: ReturnType<typeof spyOnToasts>;

let watch: ReturnType<typeof spyOn>;

let fake: ReturnType<typeof startFakeOnboarding>;

beforeEach(() => {
  startFakeServer();
  toasts = spyOnToasts();
  watch = spyOn(connectionAccounts, 'watchUsage').mockReturnValue(() => undefined);
  fake = startFakeOnboarding({
    'GET /api/github-token': { answer: TOKEN },
    'POST /api/github-token': {
      answer: (body: unknown) =>
        (body as { token: string | null }).token
          ? { ...TOKEN, saved: true, savedAt: 1 }
          : { ...TOKEN, saved: false },
    },
  });
});

afterEach(() => {
  fake.stop();
  watch.mockRestore();
  toasts.restore();
  stopFakeServer();
});

function pushShared(sharedMachine: boolean) {
  const state = createShinsaState({});
  pushState({ ...state, settings: { ...state.settings, sharedMachine } });
}

async function settle() {
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

describe('the Shared machine switch', () => {
  it('turns the machine into a shared one and says so', async () => {
    pushShared(false);
    render(
      <TooltipProvider>
        <SharedMachineRow machineId={null} />
      </TooltipProvider>
    );
    const toggle = screen.getByRole('switch', { name: 'Shared machine' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(listSentCommands()).toContainEqual({ type: 'settings.change', patch: { sharedMachine: true } })
    );
  });
});

describe('the accounts of a shared machine', () => {
  function renderAccounts() {
    pushAccounts(
      createSnapshot({
        accounts: [
          createAccount({ id: 'mine', email: 'kai@example.com', owner: 'kai' }),
          createAccount({ id: 'theirs', email: 'mona@example.com', owner: 'mona' }),
        ],
      })
    );
    return render(
      <TooltipProvider>
        <ViewerContext value={KAI}>
          <AccountSettings settings={createSettings()} />
        </ViewerContext>
      </TooltipProvider>
    );
  }

  function accountBlock(email: string) {
    let row = screen.getByText(`Claude · ${email}`).parentElement as HTMLElement;
    while (!row.textContent?.includes('’s') && !row.textContent?.includes('Yours'))
      row = row.parentElement as HTMLElement;
    return row.parentElement?.parentElement as HTMLElement;
  }

  it('marks your accounts as yours and leaves no options on a teammate’s', () => {
    pushShared(true);
    renderAccounts();
    expect(within(accountBlock('kai@example.com')).getByText('Yours')).toBeTruthy();
    expect(
      within(accountBlock('kai@example.com')).queryByRole('button', { name: 'Account options' })
    ).toBeTruthy();
    expect(within(accountBlock('mona@example.com')).getByText('mona’s')).toBeTruthy();
    expect(
      within(accountBlock('mona@example.com')).queryByRole('button', { name: 'Account options' })
    ).toBeNull();
  });

  it('saves and removes your GitHub token', async () => {
    pushShared(true);
    renderAccounts();
    expect(
      await screen.findByText("Your tasks push with this machine's GitHub login until you add a token.")
    ).toBeTruthy();
    const field = screen.getByLabelText('Your GitHub token');
    fireEvent.change(field, { target: { value: ' ghp_secret ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save token' }));
    expect(await screen.findByText('Your tasks push and open pull requests as kai.')).toBeTruthy();
    expect(toasts.success).toHaveBeenCalledWith('Your GitHub token is saved.');
    fireEvent.click(screen.getByRole('button', { name: 'Remove token' }));
    expect(
      await screen.findByText("Your tasks push with this machine's GitHub login until you add a token.")
    ).toBeTruthy();
    const writes = fake.requests
      .filter((request) => request.method === 'POST')
      .map((request) => request.body);
    expect(writes).toEqual([{ token: ' ghp_secret ' }, { token: null }]);
  });

  it('shows no token and every account’s options off a shared machine', async () => {
    pushShared(false);
    renderAccounts();
    await settle();
    expect(screen.queryByLabelText('Your GitHub token')).toBeNull();
    expect(screen.queryByText('Yours')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Account options' })).toHaveLength(2);
    expect(fake.requests.some((request) => request.path === '/api/github-token')).toBe(false);
  });
});
