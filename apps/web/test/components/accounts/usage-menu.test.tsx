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
      createWindow({ id: 's', usedPercent: usedPercent / 2 }),
      createWindow({
        id: 'w',
        kind: 'weekly' as const,
        label: 'Weekly · All models',
        usedPercent,
        resetsAt: Date.now() + 3 * 3_600_000 + 60_000,
      }),
    ],
    detail: null,
    checkedAt: Date.now(),
    source: 'read' as const,
  };
}

function renderMenu() {
  return render(
    <TooltipProvider>
      <UsageMenu state={STATE} />
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

describe('the usage menu', () => {
  it('shows the highest window of the account the next run uses', () => {
    pushAccounts(
      createSnapshot({
        accounts: [
          createAccount({ id: 'a', usage: usage(30) }),
          createAccount({ id: 'b', isDefault: true, usage: usage(42) }),
        ],
      })
    );
    renderMenu();
    expect(screen.getByRole('button', { name: 'Agent usage' }).textContent).toBe('42%');
  });

  it('lists every account with its highest window on hover', async () => {
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
    expect(await screen.findByText('The next run uses a@example.com')).toBeTruthy();
    expect(screen.getAllByText('Agent usage').length).toBeGreaterThan(0);
    expect(screen.getAllByText('80%')).toHaveLength(2);
    expect(screen.getByText('Weekly · All models')).toBeTruthy();
    expect(screen.getByText('Resets in 3h')).toBeTruthy();
    expect(screen.getByText('Signed out.')).toBeTruthy();
    expect(screen.getByText('No usage reported yet.')).toBeTruthy();
  });

  it('reads Agent usage when the next account has no figure, and goes to Settings → Agent usage on click', async () => {
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
    expect(`${location.pathname}${location.hash}`).toBe('/settings#agent-usage');
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
    expect(screen.getByText('Weekly limit')).toBeTruthy();
    expect(screen.getAllByText('64%')).toHaveLength(1);
  });

  it('is hidden without accounts', () => {
    pushAccounts(createSnapshot());
    const view = renderMenu();
    expect(view.container.textContent).toBe('');
  });
});
