import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { ShinsaState } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { PHONE_QUERY } from '@/components/layout/sidebar/compact-bar.tsx';
import { TaskHeader } from '@/components/task/header.tsx';
import { useTaskView } from '@/hooks/use-task-view.ts';
import { navigate } from '@/router.ts';
import { listSentCommands, pushState, startFakeServer, stopFakeServer } from '../../support/server.ts';
import { createGate, createRepo, createShinsaState, createTask } from '../../support/state.ts';

const TASKS = [
  createTask({
    id: 'login',
    handle: 'SW-7',
    title: 'Fix the login',
    repoId: 'paywall',
    branch: 'fix/login',
  }),
];

const REPOS = [createRepo({ id: 'paywall', name: 'paywall-next' })];

const STATE = createShinsaState({ tasks: TASKS, repos: REPOS });

const realMatchMedia = globalThis.matchMedia;

function emulateWidth(phone: boolean) {
  globalThis.matchMedia = ((query: string) => ({
    matches: phone && query === PHONE_QUERY,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof matchMedia;
}

function Header({ state }: { state: ShinsaState }) {
  const view = useTaskView(state, 'login');
  return view.task && <TaskHeader state={state} task={view.task} view={view} />;
}

function renderHeader(state = STATE) {
  act(() => navigate('/tasks/SW-7'));
  pushState(state);
  return render(
    <TooltipProvider>
      <Header state={state} />
    </TooltipProvider>
  );
}

beforeEach(() => {
  startFakeServer();
});

afterEach(() => {
  stopFakeServer();
  globalThis.matchMedia = realMatchMedia;
});

describe('the facts row on a phone', () => {
  it('shows the handle and the status and folds the rest behind Details', () => {
    emulateWidth(true);
    renderHeader();
    expect(screen.getByRole('button', { name: 'Copy SW-7' })).toBeTruthy();
    expect(screen.queryByText('paywall-next')).toBeNull();
    expect(screen.queryByText('fix/login')).toBeNull();
    const details = screen.getByRole('button', { name: 'Details' });
    expect(details.getAttribute('aria-expanded')).toBe('false');
  });

  it('opens every fact from Details and folds them again', () => {
    emulateWidth(true);
    renderHeader();
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(screen.getByText('paywall-next')).toBeTruthy();
    expect(screen.getByText('fix/login')).toBeTruthy();
    const fewer = screen.getByRole('button', { name: 'Fewer details' });
    expect(fewer.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(fewer);
    expect(screen.queryByText('paywall-next')).toBeNull();
  });
});

describe('the facts row from sm up', () => {
  it('shows every fact with no Details toggle', () => {
    emulateWidth(false);
    renderHeader();
    expect(screen.getByText('paywall-next')).toBeTruthy();
    expect(screen.getByText('fix/login')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /details/i })).toBeNull();
  });
});

describe('the Pause button', () => {
  it('pauses a working task', async () => {
    emulateWidth(false);
    renderHeader();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    });
    expect(listSentCommands()).toContainEqual({ type: 'task.pause', taskId: 'login' });
  });

  it('is gone once the task is paused', () => {
    emulateWidth(false);
    const paused = createGate({ id: 'g', taskId: 'login', type: 'failure', cause: 'paused' });
    renderHeader(createShinsaState({ tasks: TASKS, repos: REPOS, gates: [paused] }));
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
  });
});
