import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useCommandMenuOpen } from '@/lib/command/registry.ts';
import { resetOnboardingStatus } from '@/lib/connection/onboarding.ts';
import { Root } from '@/root.tsx';
import { navigate, updateSearchParams } from '@/router.ts';
import { createFlow, createOnboardingStatus, createStep, startFakeOnboarding } from './support/onboarding.ts';
import { pushState, startFakeServer, stopFakeServer } from './support/server.ts';
import { createShinsaState, createTask } from './support/state.ts';

const STATE = createShinsaState({
  tasks: [createTask({ id: 'task-1', handle: 'SW-1', title: 'Fix the login', stage: 'building' })],
});

let fake: ReturnType<typeof startFakeOnboarding> | null = null;
let idle: (() => void)[] = [];
const requestIdle = globalThis.requestIdleCallback;
const cancelIdle = globalThis.cancelIdleCallback;

beforeEach(() => {
  idle = [];
  globalThis.requestIdleCallback = ((callback: () => void) =>
    idle.push(callback)) as typeof requestIdleCallback;
  globalThis.cancelIdleCallback = () => undefined;
  fake = startFakeOnboarding({
    'GET /api/health': { answer: { ok: true, seq: 1, problems: [] } },
    'GET /api/onboarding': { answer: createOnboardingStatus() },
  });
  startFakeServer();
  act(() => navigate('/'));
});

afterEach(() => {
  cleanup();
  act(() => resetOnboardingStatus());
  stopFakeServer();
  fake?.stop();
  fake = null;
  globalThis.requestIdleCallback = requestIdle;
  globalThis.cancelIdleCallback = cancelIdle;
});

function isShown(element: HTMLElement | null) {
  return element !== null && element.closest('[style*="display: none"]') === null;
}

function composer() {
  return screen.queryByRole('textbox', { name: 'Describe the work' });
}

async function settle() {
  await act(async () => {
    for (const run of idle.splice(0)) run();
  });
}

describe('pages you have been to stay ready', () => {
  it('keeps Home mounted but hidden while another page shows, and shows the same Home again', async () => {
    render(<Root />);
    pushState(STATE);
    const home = composer();
    expect(home).not.toBeNull();
    act(() => navigate('/tasks/SW-1'));
    expect(home?.isConnected).toBe(true);
    expect(isShown(home)).toBe(false);
    act(() => navigate('/'));
    expect(composer()).toBe(home);
    expect(isShown(home)).toBe(true);
  });

  it('renders All tasks and Settings ahead of a visit once the page is idle', async () => {
    render(<Root />);
    pushState(STATE);
    expect(document.querySelectorAll('main > *').length).toBeGreaterThan(0);
    const before = document.body.innerHTML.length;
    await settle();
    expect(document.body.innerHTML.length).toBeGreaterThan(before);
    act(() => navigate('/settings'));
    expect(isShown(composer())).toBe(false);
  });

  it('keeps a task tab you leave, and shows the same one when you come back', async () => {
    render(<Root />);
    pushState(STATE);
    act(() => navigate('/tasks/SW-1'));
    const hidden = () => [...document.querySelectorAll<HTMLElement>('main [style*="display: none"]')];
    const before = new Set(document.querySelectorAll('main *'));
    const hiddenBefore = new Set(hidden());
    act(() => updateSearchParams({ tab: 'chat' }));
    const overview = hidden().find((element) => before.has(element) && !hiddenBefore.has(element));
    expect(overview).toBeDefined();
    act(() => updateSearchParams({ tab: null }));
    expect(overview?.isConnected).toBe(true);
    expect(isShown(overview ?? null)).toBe(true);
  });
});

describe('setup comes first', () => {
  function lockSetup() {
    fake?.stop();
    fake = startFakeOnboarding({
      'GET /api/health': { answer: { ok: true, seq: 1, problems: [] } },
      'GET /api/onboarding': { answer: createOnboardingStatus({}, false) },
      'GET /api/onboarding/flow': { answer: createFlow(createStep({ id: 'roots', options: [] })) },
    });
    act(() => resetOnboardingStatus());
  }

  function MenuState() {
    return <output aria-label='Command menu'>{useCommandMenuOpen() ? 'open' : 'closed'}</output>;
  }

  it('sends every page to setup until it is complete, with no way home and no command menu', async () => {
    lockSetup();
    render(
      <>
        <Root />
        <MenuState />
      </>
    );
    pushState(STATE);
    await waitFor(() => expect(location.pathname).toBe('/onboarding'));
    for (const path of ['/tasks', '/settings', '/tasks/SW-1']) {
      act(() => navigate(path));
      await waitFor(() => expect(location.pathname).toBe('/onboarding'));
    }
    expect(screen.queryByRole('button', { name: 'Home' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Shinsa/ })).toBeNull();
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(screen.getByRole('status', { name: 'Command menu' }).textContent).toBe('closed');
  });

  it('opens setup again from Settings once it is complete, and lets you leave it', async () => {
    render(<Root />);
    pushState(STATE);
    act(() => navigate('/onboarding'));
    expect(location.pathname).toBe('/onboarding');
    act(() => navigate('/tasks'));
    expect(location.pathname).toBe('/tasks');
  });
});
