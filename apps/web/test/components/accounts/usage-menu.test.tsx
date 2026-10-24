import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { UsageMenu } from '@/components/accounts/usage-menu.tsx';
import { createAccount, createProviderLogin, createSnapshot, createWindow } from '../../support/accounts.ts';
import { pushAccounts, startFakeServer, stopFakeServer } from '../../support/server.ts';
import { createShinsaState } from '../../support/state.ts';

const STATE = createShinsaState({});

beforeEach(() => {
  startFakeServer();
});

afterEach(() => {
  stopFakeServer();
});

function usage(usedPercent: number) {
  return {
    status: 'ok' as const,
    windows: [
      createWindow({ id: 's', usedPercent: usedPercent / 2, resetsAt: Date.now() + 3 * 3_600_000 + 60_000 }),
      createWindow({
        id: 'w',
        kind: 'weekly' as const,
        label: 'Weekly · All models',
        usedPercent,
        resetsAt: Date.now() + 3 * 86_400_000,
      }),
    ],
    detail: null,
    checkedAt: Date.now(),
    source: 'read' as const,
  };
}

function renderMenu(state = STATE) {
  return render(
    <TooltipProvider>
      <UsageMenu state={state} />
    </TooltipProvider>
  );
}

async function hover(element: HTMLElement) {
  await act(async () => {
    fireEvent.pointerEnter(element);
    fireEvent.mouseEnter(element);
    fireEvent.pointerMove(element);
    fireEvent.mouseMove(element);
  });
}

function markedRows() {
  return screen
    .queryAllByRole('img', { name: 'Used for the next turn' })
    .map((mark) => mark.parentElement?.textContent);
}

describe('the usage menu', () => {
  it('shows the 5-hour window of the account the next run uses, not its fuller weekly one', () => {
    pushAccounts(
      createSnapshot({
        accounts: [
          createAccount({ id: 'a', usage: usage(30) }),
          createAccount({ id: 'b', isDefault: true, usage: usage(42) }),
        ],
      })
    );
    renderMenu();
    expect(screen.getByRole('button', { name: 'Agent usage' }).textContent).toBe('21%');
  });

  it('lists every account with its 5-hour window on hover', async () => {
    pushAccounts(
      createSnapshot({
        accounts: [
          createAccount({ id: 'a', isDefault: true, usage: usage(80) }),
          createAccount({
            id: 'b',
            usage: {
              status: 'unavailable',
              windows: [],
              detail: 'Signed out.',
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
    renderMenu();
    await hover(screen.getByRole('button', { name: 'Agent usage' }));
    expect(await screen.findByText('Claude · a@example.com')).toBeTruthy();
    expect(screen.getByText('Claude · b@example.com')).toBeTruthy();
    expect(screen.queryByText(/next run uses|next turn uses/)).toBeNull();
    expect(markedRows()).toEqual(['Claude · a@example.com']);
    expect(screen.getAllByText('Agent usage').length).toBeGreaterThan(0);
    expect(screen.getAllByText('40%')).toHaveLength(2);
    expect(screen.getByText('5-hour limit')).toBeTruthy();
    expect(screen.queryByText('Weekly · All models')).toBeNull();
    expect(screen.getByText('Resets in 3h')).toBeTruthy();
    expect(screen.getByText('Signed out.')).toBeTruthy();
    expect(screen.getByText('No usage reported yet.')).toBeTruthy();
  });

  it('reads Agent usage when the next account has no figure, and goes to Settings → Agent usage → Accounts on click', async () => {
    pushAccounts(
      createSnapshot({
        accounts: [
          createAccount({
            id: 'a',
            usage: { status: 'unknown', windows: [], detail: null, checkedAt: null, source: null },
          }),
        ],
      })
    );
    renderMenu();
    const button = screen.getByRole('button', { name: 'Agent usage' });
    expect(button.textContent).toBe('Agent usage');
    fireEvent.click(button);
    expect(`${location.pathname}${location.hash}`).toBe('/settings#accounts');
  });

  it('lists Codex beside the Claude accounts, and glances at it when Codex does the work', async () => {
    pushAccounts(
      createSnapshot({
        accounts: [createAccount({ id: 'a', isDefault: true, usage: usage(30) })],
        providers: [createProviderLogin()],
      })
    );
    renderMenu();
    await hover(screen.getByRole('button', { name: 'Agent usage' }));
    expect(await screen.findByText('Codex · codex@example.com')).toBeTruthy();
    expect(screen.getAllByText('5-hour limit')).toHaveLength(2);
    expect(screen.queryByText('Weekly limit')).toBeNull();
    expect(screen.getAllByText('12%')).toHaveLength(1);
    expect(markedRows()).toEqual(['Claude · a@example.com']);
  });

  it('marks Codex as the account the next turn uses when Codex does the work', async () => {
    pushAccounts(
      createSnapshot({
        accounts: [createAccount({ id: 'a', isDefault: true, usage: usage(30) })],
        providers: [createProviderLogin()],
      })
    );
    renderMenu({ ...STATE, settings: { ...STATE.settings, defaultProvider: 'codex' } });
    const button = screen.getByRole('button', { name: 'Agent usage' });
    expect(button.textContent).toBe('12%');
    await hover(button);
    expect(await screen.findByText('Codex · codex@example.com')).toBeTruthy();
    expect(markedRows()).toEqual(['Codex · codex@example.com']);
  });

  it('is hidden without accounts', () => {
    pushAccounts(createSnapshot());
    const view = renderMenu();
    expect(view.container.textContent).toBe('');
  });
});
