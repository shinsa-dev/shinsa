import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { resolveEngineInfo } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BrowserSignInCard } from '@/components/overview/browser-sign-in-card.tsx';
import { NowCard } from '@/components/overview/now-card.tsx';
import { ReviewDraftProvider } from '@/components/task/review-draft.tsx';
import { BROWSER_REMOTE_NOTE, SIGN_IN_WINDOW_NOTE } from '@/lib/browser.ts';
import { spyOnToasts } from '../../support/commands.ts';
import { spyOnEngine } from '../../support/engine.ts';
import { startFakeOnboarding } from '../../support/onboarding.ts';
import { listSentCommands, pushState, startFakeServer, stopFakeServer } from '../../support/server.ts';
import { createGate, createProject, createRepo, createShinsaState, createTask } from '../../support/state.ts';

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

const PROJECT = '/api/browser/projects/p-1';

const DIA = { id: 'dia', name: 'Dia', isDefault: true };

const SITES = [
  { site: 'github.com', cookies: 12, signedIn: true },
  { site: 'stripe.com', cookies: 3, signedIn: true },
];

function createSignIn(site: string, { projectId = 'p-1' as string | null } = {}) {
  const task = createTask({ id: 't-1', projectId, repoId: projectId ? null : 'r-1' });
  const gate = createGate({
    id: 'g-1',
    taskId: 't-1',
    type: 'browser_sign_in',
    title: `Sign in to ${site}`,
    body: 'To check the new setting on the dashboard.',
    browserSignIn: { site, url: `https://${site}/login` },
  });
  const state = createShinsaState({
    tasks: [task],
    gates: [gate],
    repos: [createRepo({ id: 'r-1', projectId: null })],
    projects: [createProject({ id: 'p-1' })],
  });
  return { task, gate, state };
}

function renderCard(
  site: string,
  routes: FakeRoutes,
  { supported = true, projectId = 'p-1' as string | null } = {}
) {
  const engine = resolveEngineInfo('1.0.0');
  spyOnEngine(
    supported ? engine : { ...engine, features: engine.features.filter((feature) => feature !== 'browser') }
  );
  fake = startFakeOnboarding(routes);
  const { task, gate, state } = createSignIn(site, { projectId });
  const onReply = mock(async () => true);
  render(
    <TooltipProvider>
      <BrowserSignInCard state={state} task={task} gate={gate} onReply={onReply} />
    </TooltipProvider>
  );
  return onReply;
}

function sentBodies(path: string) {
  return (fake?.requests ?? [])
    .filter((request) => request.path === path && request.method === 'POST')
    .map((request) => request.body);
}

describe('the browser sign-in card', () => {
  it('copies the site from your default browser in one click and answers signed in', async () => {
    const onReply = renderCard('app.stripe.com', {
      'GET /api/browser/sources': { answer: { sources: [DIA] } },
      'GET /api/browser/sources/dia/sites': { answer: { sites: SITES } },
      [`POST ${PROJECT}/copy`]: { answer: { copied: 3, skipped: 0, sites: SITES } },
    });
    expect(screen.getByText('Sign in to app.stripe.com')).toBeDefined();
    expect(screen.getByText('To check the new setting on the dashboard.')).toBeDefined();
    expect(screen.getByText('https://app.stripe.com/login')).toBeDefined();
    fireEvent.click(await screen.findByRole('button', { name: 'Copy from Dia' }));
    await waitFor(() => expect(onReply).toHaveBeenCalledWith('signedIn'));
    expect(sentBodies(`${PROJECT}/copy`)).toEqual([{ source: 'dia', sites: ['stripe.com'] }]);
    expect(toasts.success).toHaveBeenCalledWith('Copied 3 cookies.');
  });

  it('says so when your browser is not signed in to the site, and does not answer', async () => {
    const onReply = renderCard('linear.app', {
      'GET /api/browser/sources': { answer: { sources: [DIA] } },
      'GET /api/browser/sources/dia/sites': { answer: { sites: SITES } },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Copy from Dia' }));
    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith('No linear.app sign-in in Dia.'));
    expect(onReply).not.toHaveBeenCalled();
  });

  it('offers only the sign-in window for Google, then answers once you press Done', async () => {
    const onReply = renderCard('accounts.google.com', {
      'GET /api/browser/sources': { answer: { sources: [DIA] } },
      [`POST ${PROJECT}/window`]: { answer: { mode: 'window', sites: [] } },
      [`POST ${PROJECT}/window/close`]: { answer: { mode: 'stopped', sites: [] } },
    });
    await screen.findByRole('button', { name: 'Choose sites…' });
    expect(screen.queryByRole('button', { name: 'Copy from Dia' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open sign-in window' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Done' }));
    expect(screen.getByText(SIGN_IN_WINDOW_NOTE)).toBeDefined();
    await waitFor(() => expect(onReply).toHaveBeenCalledWith('signedIn'));
    expect(sentBodies(`${PROJECT}/window`)).toEqual([{ url: 'https://accounts.google.com/login' }]);
    expect(sentBodies(`${PROJECT}/window/close`)).toHaveLength(1);
  });

  it('toasts a window Chrome could not open and stays as it was', async () => {
    renderCard('github.com', {
      'GET /api/browser/sources': { status: 400, answer: { error: { code: 'x', message: 'No.' } } },
      [`POST ${PROJECT}/window`]: {
        status: 400,
        answer: { error: { code: 'browser_not_installed', message: 'Install Google Chrome first.' } },
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Open sign-in window' }));
    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith('Install Google Chrome first.'));
    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Choose sites…' })).toBeNull();
  });

  it('copies the sites you choose and answers signed in', async () => {
    const onReply = renderCard('github.com', {
      'GET /api/browser/sources': { answer: { sources: [DIA] } },
      'GET /api/browser/sources/dia/sites': { answer: { sites: SITES } },
      [`POST ${PROJECT}/copy`]: { answer: { copied: 12, skipped: 0, sites: SITES } },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Choose sites…' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'github.com' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy 1 site' }));
    await waitFor(() => expect(onReply).toHaveBeenCalledWith('signedIn'));
  });

  it('skips signing in', async () => {
    const onReply = renderCard('github.com', { 'GET /api/browser/sources': { answer: { sources: [DIA] } } });
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    await waitFor(() => expect(onReply).toHaveBeenCalledWith('skipSignIn'));
  });

  it('answers by hand where this page cannot reach the machine’s browser', async () => {
    const onReply = renderCard('github.com', {}, { supported: false });
    expect(screen.getByText(BROWSER_REMOTE_NOTE)).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Open sign-in window' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'I signed in' }));
    await waitFor(() => expect(onReply).toHaveBeenCalledWith('signedIn'));
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    await waitFor(() => expect(onReply).toHaveBeenCalledWith('skipSignIn'));
  });

  it('answers by hand for a task with no project', () => {
    renderCard('github.com', {}, { projectId: null });
    expect(screen.getByRole('button', { name: 'I signed in' })).toBeDefined();
  });
});

describe('the browser sign-in request on the overview', () => {
  beforeEach(() => startFakeServer());

  afterEach(() => stopFakeServer());

  it('shows its card and answers the gate', async () => {
    spyOnEngine(resolveEngineInfo('1.0.0'));
    fake = startFakeOnboarding({ 'GET /api/browser/sources': { answer: { sources: [] } } });
    const { task, gate, state } = createSignIn('github.com');
    pushState(state);
    render(
      <TooltipProvider>
        <ReviewDraftProvider enabled draftKey={task.id}>
          <NowCard state={state} task={task} gate={gate} onOpen={mock()} />
        </ReviewDraftProvider>
      </TooltipProvider>
    );
    expect(screen.getByText('Sign in to github.com')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    await waitFor(() =>
      expect(listSentCommands()).toContainEqual(
        expect.objectContaining({ type: 'gate.answer', gateId: 'g-1', decision: 'reject' })
      )
    );
  });
});
