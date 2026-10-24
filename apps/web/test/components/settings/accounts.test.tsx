import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { type AccountsSnapshot, createSettings, type ProviderLogin } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AccountSettings } from '@/components/settings/accounts.tsx';
import { closeSignIn, useSignInDialog } from '@/lib/connection/accounts.ts';
import { createAccount, createProviderLogin, createSnapshot, createWindow } from '../../support/accounts.ts';
import { spyOnToasts } from '../../support/commands.ts';
import { startFakeOnboarding } from '../../support/onboarding.ts';
import { pushAccounts, startFakeServer, stopFakeServer } from '../../support/server.ts';

const HOUR = 3_600_000;

const CODEX_SIGNED_OUT: ProviderLogin = {
  provider: 'codex',
  label: 'Codex',
  status: 'signed_out',
  method: null,
  version: '0.153.4',
  detail: 'Not logged in',
  fix: 'Run `codex login` in a terminal, then refresh.',
};

let fake: ReturnType<typeof startFakeOnboarding>;

let toasts: ReturnType<typeof spyOnToasts>;

const ACCOUNTS = createSnapshot({
  accounts: [
    createAccount({ id: 'a', isDefault: true }),
    createAccount({ id: 'b', plan: 'pro', signIn: 'signed_out' }),
    createAccount({ id: 'c', plan: null, paused: true, spentUntil: Date.now() + HOUR }),
    createAccount({ id: 'd', spentUntil: Date.now() + HOUR }),
  ],
});

function DialogProbe() {
  const dialog = useSignInDialog();
  return (
    <output aria-label='Sign-in dialog'>
      {dialog.open ? `open ${dialog.accountId ?? 'new'}` : 'closed'}
    </output>
  );
}

beforeEach(() => {
  toasts = spyOnToasts();
  startFakeServer();
  fake = startFakeOnboarding({
    'POST /api/accounts/update': { answer: ACCOUNTS },
    'POST /api/accounts/remove': { answer: ACCOUNTS },
    'POST /api/accounts/import': { answer: ACCOUNTS },
    'POST /api/accounts/login': { answer: createSnapshot() },
    'POST /api/accounts/refresh': {
      answer: createSnapshot({
        accounts: [createAccount({ id: 'a' })],
        providers: [{ ...CODEX_SIGNED_OUT, status: 'signed_in', method: 'ChatGPT', fix: null }],
      }),
    },
  });
});

afterEach(() => {
  act(() => closeSignIn());
  fake.stop();
  toasts.restore();
  stopFakeServer();
});

function renderAccounts(snapshot: AccountsSnapshot) {
  pushAccounts(snapshot);
  return render(
    <TooltipProvider>
      <AccountSettings settings={createSettings()} />
      <DialogProbe />
    </TooltipProvider>
  );
}

async function settle() {
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

function updates() {
  return fake.requests
    .filter((request) => request.path === '/api/accounts/update')
    .map((request) => request.body);
}

async function openMenu(email: string) {
  await openOptions(`Claude · ${email}`);
}

async function openOptions(name: string) {
  let row = screen.getByText(name).parentElement as HTMLElement;
  while (!within(row).queryByRole('button', { name: 'Account options' }))
    row = row.parentElement as HTMLElement;
  fireEvent.click(within(row).getByRole('button', { name: 'Account options' }));
  await settle();
}

async function pickItem(name: string | RegExp) {
  fireEvent.click(screen.getByRole('menuitem', { name }));
  await settle();
}

describe('the Accounts settings', () => {
  it('lists each account with its provider, plan, default mark, status and usage', () => {
    renderAccounts(ACCOUNTS);
    expect(screen.getByText('Claude · a@example.com')).toBeTruthy();
    expect(screen.getAllByText('Max')).toHaveLength(2);
    expect(screen.getByText('Pro')).toBeTruthy();
    expect(screen.getByText('Default')).toBeTruthy();
    expect(screen.getByText('Needs sign-in')).toBeTruthy();
    expect(screen.getByText('Paused')).toBeTruthy();
    expect(screen.getByText(/^Out of usage until /)).toBeTruthy();
    expect(screen.getAllByText('20%')).toHaveLength(4);
  });

  it('reads an account whose window is used up as out of usage, though the server has not marked it yet', () => {
    renderAccounts(
      createSnapshot({
        accounts: [
          createAccount({
            id: 'full',
            usage: {
              status: 'ok',
              windows: [createWindow({ id: 'full-s', usedPercent: 100, resetsAt: Date.now() + 3_600_000 })],
              detail: null,
              checkedAt: Date.now(),
              source: 'read',
            },
          }),
        ],
      })
    );
    expect(screen.getByText(/^Out of usage until /)).toBeTruthy();
  });

  it('shows every window of every account with its reset, bar and percentage', () => {
    renderAccounts(
      createSnapshot({
        accounts: [
          createAccount({
            id: 'a',
            usage: {
              status: 'ok',
              windows: [
                createWindow({ id: 's', usedPercent: 42, resetsAt: Date.now() + 3 * HOUR + 60_000 }),
                createWindow({
                  id: 'w',
                  kind: 'weekly',
                  label: 'Weekly · All models',
                  usedPercent: 91,
                  resetsAt: null,
                }),
              ],
              detail: null,
              checkedAt: Date.now() - 2 * 60_000,
              source: 'cache',
            },
          }),
          createAccount({
            id: 'b',
            plan: null,
            usage: {
              status: 'unavailable',
              windows: [],
              detail: 'Claude did not report usage.',
              checkedAt: null,
              source: null,
            },
          }),
          createAccount({
            id: 'c',
            usage: { status: 'unknown', windows: [], detail: null, checkedAt: null, source: null },
          }),
        ],
      })
    );
    expect(screen.getByText('5-hour limit')).toBeTruthy();
    expect(screen.getByText('Resets in 3h')).toBeTruthy();
    expect(screen.getByText('42%')).toBeTruthy();
    expect(screen.getByText('Weekly · All models')).toBeTruthy();
    expect(screen.getByText('91%')).toBeTruthy();
    expect(screen.getAllByText('Updated 2m ago')).toHaveLength(1);
    expect(screen.getByText('Claude did not report usage.')).toBeTruthy();
    expect(screen.getByText('No usage reported yet.')).toBeTruthy();
  });

  it('refreshes the usage of every account from one button in the section header', async () => {
    renderAccounts(ACCOUNTS);
    expect(screen.getAllByRole('button', { name: 'Refresh usage' })).toHaveLength(1);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh usage' }));
    });
    await settle();
    expect(fake.requests.map((request) => request.path)).toEqual(['/api/accounts/refresh']);
  });

  it('shows Codex in the same section: its state and the command that fixes it, never its CLI version', async () => {
    renderAccounts({ ...ACCOUNTS, providers: [CODEX_SIGNED_OUT] });
    expect(screen.getByText('Codex')).toBeTruthy();
    expect(screen.getByText('Not signed in')).toBeTruthy();
    expect(screen.getAllByText('Needs sign-in')).toHaveLength(2);
    expect(screen.queryByText('0.153.4')).toBeNull();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
    await openOptions('Codex');
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Check the Codex sign-in again',
    ]);
    await pickItem('Check the Codex sign-in again');
    await waitFor(() => expect(screen.getByText('Signed in with ChatGPT')).toBeTruthy());
    expect(fake.requests.map((request) => request.path)).toEqual(['/api/accounts/refresh']);
  });

  it('shows a signed-in Codex like a Claude account: its plan, when its usage was read and its windows', async () => {
    const codex = createProviderLogin({ version: '0.159.0' });
    const usage = codex.usage && { ...codex.usage, checkedAt: Date.now() };
    renderAccounts({ ...ACCOUNTS, providers: [{ ...codex, usage }] });
    expect(screen.getByText('Codex · codex@example.com')).toBeTruthy();
    expect(screen.getByText('Plus')).toBeTruthy();
    expect(screen.queryByText('0.159.0')).toBeNull();
    expect(screen.getByText('Updated just now')).toBeTruthy();
    expect(screen.getAllByText('5-hour limit')).toHaveLength(5);
    expect(screen.getByText('Weekly limit')).toBeTruthy();
    expect(screen.getByText('64%')).toBeTruthy();
    expect(screen.queryByText(/More than one Codex account is not supported yet/)).toBeNull();
    await openOptions('Codex · codex@example.com');
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Copy the sign-in command',
      'Check the Codex sign-in again',
    ]);
    await pickItem('Copy the sign-in command');
    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith('Copied'));
  });

  it('says how to start when there is no account, and signs in a new one', async () => {
    renderAccounts(createSnapshot({ providers: [CODEX_SIGNED_OUT] }));
    expect(
      screen.getByText('Add a Claude account so agents can run on it and switch when one runs out of usage.')
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Refresh usage' })).toBeNull();
    expect(screen.getByText('Not signed in')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add account' }));
    await settle();
    expect(screen.getByRole('status', { name: 'Sign-in dialog' }).textContent).toBe('open new');
  });

  it('offers the logins it can import next to signing in another account', async () => {
    renderAccounts({
      ...ACCOUNTS,
      imports: [
        { origin: 'claude', email: 'me@example.com', plan: 'max' },
        { origin: 'cswap', email: 'two@example.com', plan: 'pro' },
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add account' }));
    await settle();
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Sign in with another account',
      'Use your Claude Code loginme@example.com',
      'Import two@example.com from claude-swap',
    ]);
    await pickItem('Import two@example.com from claude-swap');
    expect(fake.requests.at(-1)?.body).toEqual({ origin: 'cswap', email: 'two@example.com' });
  });

  it('signs in another account from the Add account menu', async () => {
    renderAccounts({ ...ACCOUNTS, imports: [{ origin: 'claude', email: 'me@example.com', plan: 'max' }] });
    fireEvent.click(screen.getByRole('button', { name: 'Add account' }));
    await settle();
    await pickItem('Sign in with another account');
    expect(screen.getByRole('status', { name: 'Sign-in dialog' }).textContent).toBe('open new');
  });

  it('sets the default, reorders and leaves accounts out of new work', async () => {
    renderAccounts(ACCOUNTS);
    await openMenu('b@example.com');
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Set as default',
      'Sign in again',
      'Move up',
      'Move down',
      'Leave out of new work',
      'Switch accounts at',
      'Remove',
    ]);
    await pickItem('Set as default');
    await openMenu('b@example.com');
    await pickItem('Move up');
    await openMenu('b@example.com');
    await pickItem('Move down');
    await openMenu('b@example.com');
    await pickItem('Leave out of new work');
    await openMenu('c@example.com');
    await pickItem('Use for new work');
    await waitFor(() =>
      expect(updates()).toEqual([
        { accountId: 'b', patch: { isDefault: true } },
        { accountId: 'b', patch: { position: 0 } },
        { accountId: 'b', patch: { position: 2 } },
        { accountId: 'b', patch: { paused: true } },
        { accountId: 'c', patch: { paused: false } },
      ])
    );
    expect(toasts.success.mock.calls.map(([text]) => text)).toEqual([
      'b@example.com is the default account.',
      'Moved up.',
      'Moved down.',
      'New work skips b@example.com.',
      'c@example.com takes new work again.',
    ]);
  });

  it('keeps the first account from moving up', async () => {
    renderAccounts(ACCOUNTS);
    await openMenu('a@example.com');
    const items = screen.getAllByRole('menuitem').map((item) => item.textContent);
    expect(items).not.toContain('Move up');
    expect(items).not.toContain('Set as default');
  });

  it('keeps the last account from moving down', async () => {
    renderAccounts(ACCOUNTS);
    await openMenu('d@example.com');
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).not.toContain('Move down');
  });

  it('signs an account in again', async () => {
    renderAccounts(ACCOUNTS);
    await openMenu('b@example.com');
    await pickItem('Sign in again');
    expect(screen.getByRole('status', { name: 'Sign-in dialog' }).textContent).toBe('open b');
  });

  it('removes an account only after you confirm', async () => {
    renderAccounts(ACCOUNTS);
    await openMenu('d@example.com');
    await pickItem('Remove');
    expect(screen.getByText('Remove d@example.com?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    await settle();
    expect(fake.requests.some((request) => request.path === '/api/accounts/remove')).toBe(false);
    await openMenu('d@example.com');
    await pickItem('Remove');
    fireEvent.click(screen.getByRole('button', { name: 'Remove account' }));
    expect(fake.requests.some((request) => request.path === '/api/accounts/remove')).toBe(false);
    await settle();
    await waitFor(() =>
      expect(fake.requests.at(-1)).toMatchObject({ path: '/api/accounts/remove', body: { accountId: 'd' } })
    );
    expect(toasts.success).toHaveBeenCalledWith('Account removed.');
  });
});

describe('an account’s switch threshold', () => {
  async function openThresholds(email: string) {
    await openMenu(email);
    const trigger = screen.getByRole('menuitem', { name: 'Switch accounts at' });
    fireEvent.pointerEnter(trigger);
    fireEvent.mouseEnter(trigger);
    fireEvent.pointerMove(trigger);
    fireEvent.mouseMove(trigger);
    await screen.findByRole('menuitemradio', { name: 'Other…' });
  }

  it('follows the setting or picks a percentage', async () => {
    renderAccounts(ACCOUNTS);
    await openThresholds('a@example.com');
    expect(screen.getAllByRole('menuitemradio').map((item) => item.textContent)).toEqual([
      'Use the setting (90%)',
      '80%',
      '90%',
      '95%',
      '98%',
      'Other…',
    ]);
    fireEvent.click(screen.getByRole('menuitemradio', { name: '95%' }));
    await settle();
    expect(updates()).toEqual([{ accountId: 'a', patch: { switchAt: 95 } }]);
    expect(toasts.success).toHaveBeenCalledWith('Switches away from a@example.com at 95%.');
  });

  it('goes back to the setting', async () => {
    renderAccounts({ ...ACCOUNTS, accounts: [createAccount({ id: 'a', switchAt: 95 })] });
    await openThresholds('a@example.com');
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Use the setting (90%)' }));
    await settle();
    expect(updates()).toEqual([{ accountId: 'a', patch: { switchAt: null } }]);
  });

  it('saves the percentage typed in Other… for that account', async () => {
    renderAccounts({ ...ACCOUNTS, accounts: [createAccount({ id: 'a', switchAt: 70 })] });
    await openThresholds('a@example.com');
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Other…' }));
    const field = (await screen.findByRole('textbox', { name: 'Percentage' })) as HTMLInputElement;
    expect(field.value).toBe('70');
    fireEvent.change(field, { target: { value: '85' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save percentage' }));
    });
    await waitFor(() => expect(updates()).toEqual([{ accountId: 'a', patch: { switchAt: 85 } }]));
  });
});
