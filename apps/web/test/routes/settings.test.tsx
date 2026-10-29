import { afterEach, beforeEach, describe, expect, it, type Mock, mock, spyOn } from 'bun:test';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { resetOnboardingStatus } from '@/lib/connection/onboarding.ts';
import { SettingsPage } from '@/routes/settings.tsx';
import { createAccount, createSnapshot } from '../support/accounts.ts';
import { findTooltipText } from '../support/hover.ts';
import { createOnboardingStatus } from '../support/onboarding.ts';
import { createRound } from '../support/rounds.ts';
import { clearAccounts, pushAccounts, startFakeServer, stopFakeServer } from '../support/server.ts';
import { createRun, createShinsaState, createTask } from '../support/state.ts';

let requests: Mock<(input: RequestInfo | URL) => Promise<Response>>;

const scrollIntoView = HTMLElement.prototype.scrollIntoView;

beforeEach(() => {
  resetOnboardingStatus();
  requests = spyOn(globalThis, 'fetch').mockResolvedValue(new Response('offline', { status: 503 }));
  startFakeServer();
  clearAccounts();
});

afterEach(async () => {
  await settle();
  requests.mockRestore();
  stopFakeServer();
  HTMLElement.prototype.scrollIntoView = scrollIntoView;
});

async function settle() {
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

function visit(path: string) {
  history.replaceState(null, '', path);
  dispatchEvent(new PopStateEvent('popstate'));
}

async function renderSettings(path = '/settings', state = createShinsaState({ tasks: [] })) {
  visit(path);
  const view = render(
    <TooltipProvider>
      <SettingsPage state={state} />
    </TooltipProvider>
  );
  await settle();
  return view;
}

describe('Settings tabs', () => {
  it('opens on General and keeps every other tab in the URL', async () => {
    await renderSettings();
    const tabs = screen.getByRole('tablist', { name: 'Settings sections' });
    expect(
      within(tabs)
        .getAllByRole('tab')
        .map((tab) => tab.textContent)
    ).toEqual(['General', 'Statistics', 'Agents', 'Agent usage', 'Projects', 'Integrations', 'Automations']);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('General');
    for (const section of ['Appearance', 'Attention', 'Notifications', 'Context', 'Setup', 'Updates'])
      expect(screen.getByText(section)).toBeTruthy();
    expect(screen.queryByText('Engine')).toBeNull();
    fireEvent.click(within(tabs).getByRole('tab', { name: 'Agents' }));
    await settle();
    expect(location.search).toBe('?tab=agents');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Agents');
    expect(screen.getByText('Engine')).toBeTruthy();
    expect(screen.getByText('Versions')).toBeTruthy();
    expect(screen.queryByText('Appearance')).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Settings sections' })).toBeNull();
    expect(within(tabs).getByRole('tab', { name: 'Agents' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(within(tabs).getByRole('tab', { name: 'General' }));
    await settle();
    expect(location.search).toBe('');
    expect(screen.getByText('Appearance')).toBeTruthy();
  });

  it('explains each layout on its option in Appearance', async () => {
    await renderSettings();
    const layouts = screen.getByRole('tablist', { name: 'Layout' });
    expect(await findTooltipText(within(layouts).getByRole('tab', { name: 'Desk' }))).toBe(
      'Pages sit centred with nothing at the sides, and a button at the top opens what needs you.'
    );
  });

  it('opens the tab of a linked section and scrolls to it once the accounts are in', async () => {
    const scroll = mock((_options?: ScrollIntoViewOptions) => {});
    HTMLElement.prototype.scrollIntoView = scroll;
    await renderSettings('/settings#limits');
    expect(scroll).not.toHaveBeenCalled();
    pushAccounts(createSnapshot({ accounts: [createAccount({ id: 'a' })] }));
    await settle();
    expect(screen.getByText('Limits')).toBeTruthy();
    expect(scroll).toHaveBeenCalledWith({ block: 'start' });
  });

  it('scrolls to Repository folders once the folders are in', async () => {
    const folders = Promise.withResolvers<Response>();
    requests.mockImplementation((input) => {
      if (String(input) === '/api/onboarding') return folders.promise;
      return Promise.resolve(new Response('offline', { status: 503 }));
    });
    const scroll = mock((_options?: ScrollIntoViewOptions) => {});
    HTMLElement.prototype.scrollIntoView = scroll;
    await renderSettings('/settings?tab=projects#repository-folders');
    pushAccounts(createSnapshot({ accounts: [createAccount({ id: 'a' })] }));
    await settle();
    expect(scroll).not.toHaveBeenCalled();
    folders.resolve(Response.json(createOnboardingStatus({ configured: ['/Users/me/code'] })));
    await waitFor(() => expect(scroll).toHaveBeenCalledWith({ block: 'start' }));
    expect(screen.getByText('Repository folders')).toBeTruthy();
  });
});

describe('Settings stats', () => {
  it('shows what shipped in the range, the year graph and the chart, and keeps the range in the URL', async () => {
    const mergedAt = Date.now();
    const pullRequest = {
      number: 12,
      url: 'u',
      state: 'merged' as const,
      base: 'main',
      changes: { additions: 40, deletions: 2, changedFiles: 3 },
    };
    const task = createTask({
      id: 't1',
      stage: 'merged',
      closedAt: mergedAt,
      rounds: [createRound({ number: 1, endedAt: mergedAt, pullRequest })],
    });
    await renderSettings('/settings?tab=statistics', createShinsaState({ tasks: [task] }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Statistics');
    expect(screen.getByText('Pull requests merged')).toBeTruthy();
    expect(screen.getByText('+40 −2')).toBeTruthy();
    expect(screen.getByText('Lines changed in 3 files')).toBeTruthy();
    expect(screen.getByText('1 day')).toBeTruthy();
    const graph = screen.getByRole('img', { name: '1 pull request merged in the last year' });
    const cells = graph.querySelectorAll('[data-day]');
    fireEvent.pointerEnter([...cells].at(-1) as Element);
    expect(within(screen.getByRole('status')).getByText('1 pull request')).toBeTruthy();
    fireEvent.pointerLeave(graph);
    expect(screen.queryByRole('status')).toBeNull();
    const chart = screen.getByRole('img', { name: 'Pull requests merged over time' });
    chart.getBoundingClientRect = () => ({ left: 0, width: 100, height: 160 }) as DOMRect;
    fireEvent.pointerMove(chart, { clientX: 100 });
    expect(within(screen.getByRole('status')).getByText('1 pull request')).toBeTruthy();
    fireEvent.pointerLeave(chart);
    expect(screen.queryByRole('status')).toBeNull();
    fireEvent.click(screen.getByRole('combobox', { name: 'Statistics range' }));
    await settle();
    const list = screen.getAllByRole('listbox').at(-1) as HTMLElement;
    const ninety = within(list).getByRole('option', { name: 'Last 90 days' });
    fireEvent.pointerDown(ninety, { pointerType: 'mouse' });
    fireEvent.click(ninety);
    await settle();
    expect(location.search).toBe('?tab=statistics&range=90');
    expect(screen.getAllByText('Last 90 days').length).toBeGreaterThan(0);
  });

  it('shows where the tokens went, the tasks that used the most and where to save', async () => {
    const now = Date.now();
    const heavy = {
      inputTokens: 300_000,
      outputTokens: 5_000,
      cacheReadTokens: 50_000,
      cacheWriteTokens: 50_000,
    };
    const task = createTask({ id: 't1', title: 'Rebuild the parser' });
    const runs = [
      createRun({
        id: 'r1',
        taskId: 't1',
        purpose: 'build',
        model: 'claude-opus-5-5',
        startedAt: now,
        endedAt: now,
        usage: { ...heavy, costUsd: 2 },
      }),
      createRun({
        id: 'r2',
        taskId: 'gone',
        role: 'reviewer',
        startedAt: now,
        endedAt: now,
        usage: { inputTokens: 10, outputTokens: 10, cacheReadTokens: 80, cacheWriteTokens: 0, costUsd: null },
      }),
    ];
    await renderSettings('/settings?tab=statistics', createShinsaState({ tasks: [task], runs }));
    expect(screen.getByText('Token usage')).toBeTruthy();
    expect(screen.getAllByText('$2.00').length).toBeGreaterThan(1);
    expect(screen.getByText('Building')).toBeTruthy();
    expect(screen.getByText('Review')).toBeTruthy();
    expect(screen.getByText('Opus 5.5')).toBeTruthy();
    expect(screen.getByText('Unknown model')).toBeTruthy();
    expect(document.querySelectorAll('[data-task="t1"]').length).toBe(2);
    expect(screen.getByText('gone')).toBeTruthy();
    expect(screen.getByText('Only 13% of the prompt came from the cache')).toBeTruthy();
    const chart = screen.getByRole('img', { name: 'Tokens over time' });
    chart.getBoundingClientRect = () => ({ left: 0, width: 100, height: 160 }) as DOMRect;
    fireEvent.pointerMove(chart, { clientX: 99 });
    const readout = screen.getByRole('status');
    expect(within(readout).getByText('Total')).toBeTruthy();
    expect(within(readout).getByText('405k')).toBeTruthy();
    expect(within(readout).getByText('Cache read')).toBeTruthy();
    fireEvent.pointerLeave(chart);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('says so when no agent ran and nothing stands out', async () => {
    await renderSettings('/settings?tab=statistics', createShinsaState({}));
    expect(screen.getAllByText('No agent runs')).toHaveLength(4);
    expect(screen.getByText('Nothing stands out in this range.')).toBeTruthy();
  });
});
