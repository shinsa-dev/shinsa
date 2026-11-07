import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { RemoteUser, ShinsaState } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueueMenu } from '@/components/queue/menu.tsx';
import { TaskQueue } from '@/components/queue/queue.tsx';
import { ViewerContext } from '@/lib/remote/viewer.ts';
import { HomePage } from '@/routes/home.tsx';
import { TasksPage } from '@/routes/tasks.tsx';
import { pushState, startFakeServer, stopFakeServer } from '../../support/server.ts';
import { createGate, createShinsaState, createTask } from '../../support/state.ts';

const KAI: RemoteUser = { id: 'u-kai', login: 'kai', name: 'Kai Lane', avatarUrl: null };

const KAI_PROFILE = { login: 'kai', name: 'Kai Lane', avatarUrl: null };
const MONA_PROFILE = { login: 'mona', name: 'Mona Park', avatarUrl: null };

function sharedState(sharedMachine = true): ShinsaState {
  const state = createShinsaState({
    tasks: [
      createTask({ id: 'kai-task', title: 'Fix the login page', stage: 'reviewing', owner: KAI_PROFILE }),
      createTask({ id: 'mona-task', title: 'Export the invoices', stage: 'reviewing', owner: MONA_PROFILE }),
    ],
    gates: [
      createGate({ id: 'g-kai', taskId: 'kai-task', type: 'review' }),
      createGate({ id: 'g-mona', taskId: 'mona-task', type: 'review' }),
    ],
  });
  return { ...state, settings: { ...state.settings, sharedMachine } };
}

beforeEach(() => {
  startFakeServer();
});

afterEach(() => {
  stopFakeServer();
});

function renderAsKai(node: React.ReactNode, state: ShinsaState) {
  pushState(state);
  return render(
    <TooltipProvider>
      <ViewerContext value={KAI}>{node}</ViewerContext>
    </TooltipProvider>
  );
}

describe('the queue on a shared machine', () => {
  it('shows your own tasks first, and everyone’s once you switch', () => {
    const state = sharedState();
    renderAsKai(<TaskQueue state={state} variant='compact' />, state);
    expect(screen.getByText('Fix the login page')).toBeTruthy();
    expect(screen.queryByText('Export the invoices')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: "Everyone's" }));
    expect(screen.getByText('Export the invoices')).toBeTruthy();
    expect(screen.getByRole('button', { name: "Everyone's" }).getAttribute('aria-pressed')).toBe('true');
  });

  it('counts only your decisions on the queue button and on Home', () => {
    const state = sharedState();
    renderAsKai(
      <>
        <QueueMenu state={state} activeTaskId={null} />
        <HomePage state={state} />
      </>,
      state
    );
    expect(screen.getByText('1 needs you')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Your tasks' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('shows every task and no switch off a shared machine', () => {
    const state = sharedState(false);
    renderAsKai(<TaskQueue state={state} variant='compact' />, state);
    expect(screen.getByText('Export the invoices')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Your tasks' })).toBeNull();
  });
});

describe('All tasks on a shared machine', () => {
  it('starts on your tasks with an owner column, and shows everyone’s once the owner filter is removed', () => {
    history.replaceState(null, '', '/tasks');
    const state = sharedState();
    renderAsKai(<TasksPage state={state} />, state);
    expect(screen.getAllByText('Owner').length).toBeGreaterThan(1);
    expect(screen.getByText('Fix the login page')).toBeTruthy();
    expect(screen.queryByText('Export the invoices')).toBeNull();
    history.replaceState(null, '', '/tasks?owner=everyone');
    act(() => {
      dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(screen.getByText('Export the invoices')).toBeTruthy();
    expect(screen.getAllByText('Mona').length).toBeGreaterThan(0);
  });
});
