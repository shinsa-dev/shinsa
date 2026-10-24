import { afterEach, beforeEach, describe, expect, it, type Mock, mock, spyOn } from 'bun:test';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { resetOnboardingStatus } from '@/lib/connection/onboarding.ts';
import { SettingsPage } from '@/routes/settings.tsx';
import { createAccount, createSnapshot } from '../support/accounts.ts';
import { createOnboardingStatus } from '../support/onboarding.ts';
import { pushAccounts, startFakeServer, stopFakeServer } from '../support/server.ts';
import { createShinsaState } from '../support/state.ts';

let requests: Mock<(input: RequestInfo | URL) => Promise<Response>>;

const scrollIntoView = HTMLElement.prototype.scrollIntoView;

beforeEach(() => {
  resetOnboardingStatus();
  requests = spyOn(globalThis, 'fetch').mockResolvedValue(new Response('offline', { status: 503 }));
  startFakeServer();
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

async function renderSettings(path = '/settings') {
  visit(path);
  const view = render(
    <TooltipProvider>
      <SettingsPage state={createShinsaState({ tasks: [] })} />
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
    ).toEqual(['General', 'Agents', 'Agent usage', 'Projects', 'Integrations', 'Automations']);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('General');
    for (const section of ['Appearance', 'Attention', 'Notifications', 'Context', 'Setup'])
      expect(screen.getByText(section)).toBeTruthy();
    expect(screen.queryByText('Engine')).toBeNull();
    fireEvent.click(within(tabs).getByRole('tab', { name: 'Agents' }));
    await settle();
    expect(location.search).toBe('?tab=agents');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Agents');
    expect(screen.getByText('Engine')).toBeTruthy();
    expect(screen.queryByText('Appearance')).toBeNull();
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    expect(within(nav).getByRole('button', { name: 'Agents' }).getAttribute('aria-current')).toBe('page');
    fireEvent.click(within(nav).getByRole('button', { name: 'General' }));
    await settle();
    expect(location.search).toBe('');
    expect(screen.getByText('Appearance')).toBeTruthy();
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
