import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { resolveEngineInfo } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BrowserSettings } from '@/components/settings/browser.tsx';
import { COPY_DIALOG_DESCRIPTION } from '@/lib/browser.ts';
import { spyOnToasts } from '../../support/commands.ts';
import { spyOnEngine } from '../../support/engine.ts';
import { startFakeOnboarding } from '../../support/onboarding.ts';
import { createProject, createShinsaState } from '../../support/state.ts';
import { waitForGone } from '../../support/wait.ts';

type FakeRoutes = Parameters<typeof startFakeOnboarding>[0];

let fake: ReturnType<typeof startFakeOnboarding> | null = null;

let toasts: ReturnType<typeof spyOnToasts>;

beforeEach(() => {
  toasts = spyOnToasts();
});

afterEach(() => {
  fake?.stop();
  fake = null;
  toasts.restore();
});

const SITES = [
  { site: 'github.com', cookies: 12, signedIn: true },
  { site: 'vercel.com', cookies: 4, signedIn: true },
  { site: 'stripe.com', cookies: 6, signedIn: true },
  { site: 'linear.app', cookies: 3, signedIn: true },
  { site: 'tracker.net', cookies: 2, signedIn: false },
];

const PROJECT = '/api/browser/projects/p-1';

function renderBrowser(
  routes: FakeRoutes,
  { supported = true, projects = [createProject({ id: 'p-1', name: 'Superwall' })] } = {}
) {
  const engine = resolveEngineInfo('1.0.0');
  spyOnEngine(
    supported ? engine : { ...engine, features: engine.features.filter((feature) => feature !== 'browser') }
  );
  fake = startFakeOnboarding(routes);
  return render(
    <TooltipProvider>
      <BrowserSettings state={createShinsaState({ projects })} />
    </TooltipProvider>
  );
}

function sent(path: string) {
  return (fake?.requests ?? []).filter((request) => request.path === path && request.method === 'POST');
}

describe('Settings → Browser', () => {
  it('shows nothing when the engine has no shared browser', () => {
    const { container } = renderBrowser({}, { supported: false });
    expect(container.textContent).toBe('');
  });

  it('asks for a project first when there is none', () => {
    renderBrowser({}, { projects: [] });
    expect(screen.getByText('Create a project first. Each project gets its own browser.')).toBeDefined();
  });

  it('lists the sites each project’s browser is signed in to', async () => {
    renderBrowser({ [`GET ${PROJECT}`]: { answer: { mode: 'stopped', sites: SITES } } });
    expect(screen.getByText('Reading its sites…')).toBeDefined();
    expect(await screen.findByText('github.com')).toBeDefined();
    expect(screen.getByText('12 cookies')).toBeDefined();
    for (const site of ['vercel.com', 'stripe.com', 'linear.app'])
      expect(screen.getByText(site)).toBeDefined();
    expect(screen.queryByText('tracker.net')).toBeNull();
    expect(screen.getByText('Superwall')).toBeDefined();
    expect(screen.getByText('P-')).toBeDefined();
  });

  it('says so when a project’s browser is signed in nowhere, and toasts a failed read', async () => {
    renderBrowser({
      [`GET ${PROJECT}`]: { status: 400, answer: { error: { code: 'x', message: 'Not found.' } } },
    });
    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith('Not found.'));
  });

  it('opens the sign-in window and closes it with Done', async () => {
    renderBrowser({
      [`GET ${PROJECT}`]: { answer: { mode: 'stopped', sites: [] } },
      [`POST ${PROJECT}/window`]: { answer: { mode: 'window', sites: [] } },
      [`POST ${PROJECT}/window/close`]: { answer: { mode: 'stopped', sites: SITES.slice(0, 1) } },
    });
    expect(await screen.findByText('Not signed in to any site yet.')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Open sign-in window' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Done' }));
    expect(
      screen.getByText(
        'The window has nothing automating it, so Google lets you sign in. Agents wait until you press Done.'
      )
    ).toBeDefined();
    expect(await screen.findByText('github.com')).toBeDefined();
    expect(sent(`${PROJECT}/window`).map((request) => request.body)).toEqual([{ url: null }]);
    expect(toasts.success).toHaveBeenCalledWith('Done. Agents use the browser again.');
  });

  it('offers copying and the sign-in window in its menu, for a narrow window', async () => {
    renderBrowser({
      [`GET ${PROJECT}`]: { answer: { mode: 'stopped', sites: [] } },
      [`POST ${PROJECT}/window`]: { answer: { mode: 'window', sites: [] } },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Browser options' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Open sign-in window' }));
    expect(await screen.findByRole('button', { name: 'Done' })).toBeDefined();
    expect(sent(`${PROJECT}/window`)).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Browser options' }));
    expect(screen.queryByRole('menuitem', { name: 'Copy sign-ins…' })).toBeNull();
  });

  it('toasts a sign-in window Chrome could not open', async () => {
    renderBrowser({
      [`GET ${PROJECT}`]: { answer: { mode: 'stopped', sites: [] } },
      [`POST ${PROJECT}/window`]: {
        status: 400,
        answer: { error: { code: 'browser_not_installed', message: 'Install Google Chrome first.' } },
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Open sign-in window' }));
    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith('Install Google Chrome first.'));
    expect(screen.getByRole('button', { name: 'Open sign-in window' })).toBeDefined();
  });

  it('signs a project’s browser out of everything after you confirm', async () => {
    renderBrowser({
      [`GET ${PROJECT}`]: { answer: { mode: 'headless', sites: SITES } },
      [`POST ${PROJECT}/sign-out`]: { answer: { mode: 'stopped', sites: [] } },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Browser options' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Sign out of everything…' }));
    expect(
      await screen.findByText(
        'Shinsa deletes Superwall’s browser profile, so its agents are signed out of every site.'
      )
    ).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByText('Not signed in to any site yet.')).toBeDefined();
    expect(sent(`${PROJECT}/sign-out`)).toHaveLength(1);
    expect(toasts.success).toHaveBeenCalledWith('Signed Superwall’s browser out.');
  });

  it('copies only the sites you tick from the browser you pick', async () => {
    renderBrowser({
      [`GET ${PROJECT}`]: { answer: { mode: 'stopped', sites: [] } },
      'GET /api/browser/sources': {
        answer: {
          sources: [
            { id: 'chrome', name: 'Chrome', isDefault: false },
            { id: 'dia', name: 'Dia', isDefault: true },
          ],
        },
      },
      'GET /api/browser/sources/dia/sites': { answer: { sites: SITES } },
      [`POST ${PROJECT}/copy`]: { answer: { copied: 16, skipped: 1, sites: SITES.slice(0, 2) } },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Copy sign-ins' }));
    expect(await screen.findByText(COPY_DIALOG_DESCRIPTION)).toBeDefined();
    expect(await screen.findByRole('checkbox', { name: 'github.com' })).toBeDefined();
    expect(screen.queryByRole('checkbox', { name: 'tracker.net' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Copy sites' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: 'github.com' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'vercel.com' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'vercel.com' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'vercel.com' }));
    fireEvent.change(screen.getByLabelText('Find a site'), { target: { value: 'track' } });
    expect(screen.getByRole('checkbox', { name: 'tracker.net' })).toBeDefined();
    expect(screen.getByText('Not signed in')).toBeDefined();
    fireEvent.change(screen.getByLabelText('Find a site'), { target: { value: 'nothing' } });
    expect(screen.getByText('No site matches.')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Copy 2 sites' }));
    await waitForGone(() => screen.queryByText(COPY_DIALOG_DESCRIPTION));
    expect(sent(`${PROJECT}/copy`).map((request) => request.body)).toEqual([
      { source: 'dia', sites: ['github.com', 'vercel.com'] },
    ]);
    expect(toasts.success).toHaveBeenCalledWith('Copied 16 cookies. Skipped 1 expired one.');
    await waitFor(() =>
      expect((fake?.requests ?? []).filter((request) => request.path === PROJECT)).toHaveLength(2)
    );
  });

  it('keeps the dialog open and toasts when macOS refuses the key', async () => {
    renderBrowser({
      [`GET ${PROJECT}`]: { answer: { mode: 'stopped', sites: [] } },
      'GET /api/browser/sources': { answer: { sources: [{ id: 'dia', name: 'Dia', isDefault: true }] } },
      'GET /api/browser/sources/dia/sites': { answer: { sites: SITES } },
      [`POST ${PROJECT}/copy`]: {
        status: 400,
        answer: { error: { code: 'browser_keychain_refused', message: 'macOS did not allow it.' } },
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Copy sign-ins' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'github.com' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy 1 site' }));
    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith('macOS did not allow it.'));
    expect(screen.getByText(COPY_DIALOG_DESCRIPTION)).toBeDefined();
  });

  it('says when no browser can be copied from, or the sites cannot be read', async () => {
    renderBrowser({
      [`GET ${PROJECT}`]: { answer: { mode: 'stopped', sites: [] } },
      'GET /api/browser/sources': { answer: { sources: [] } },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Copy sign-ins' }));
    expect(
      await screen.findByText(
        'No Chromium browser found on this Mac. Dia, Chrome, Arc, Brave and Edge can be copied from.'
      )
    ).toBeDefined();
  });

  it('shows why a browser’s sites could not be read', async () => {
    renderBrowser({
      [`GET ${PROJECT}`]: { answer: { mode: 'stopped', sites: [] } },
      'GET /api/browser/sources': { answer: { sources: [{ id: 'dia', name: 'Dia', isDefault: true }] } },
      'GET /api/browser/sources/dia/sites': {
        status: 400,
        answer: { error: { code: 'browser_source_unreadable', message: 'Couldn’t read Dia’s cookies.' } },
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Copy sign-ins' }));
    expect(await screen.findByText('Couldn’t read Dia’s cookies.')).toBeDefined();
  });

  it('shows why the browsers could not be listed', async () => {
    renderBrowser({
      [`GET ${PROJECT}`]: { answer: { mode: 'stopped', sites: [] } },
      'GET /api/browser/sources': { status: 400, answer: { error: { code: 'x', message: 'Engine busy.' } } },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Copy sign-ins' }));
    expect(await screen.findByText('Engine busy.')).toBeDefined();
  });
});
