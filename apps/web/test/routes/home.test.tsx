import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { Activity, ShinsaState } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { HomePage } from '@/routes/home.tsx';
import { startFakeServer, stopFakeServer } from '../support/server.ts';
import { createGate, createProject, createRepo, createShinsaState, createTask } from '../support/state.ts';

function message(at: number): Activity {
  return {
    at,
    actor: 'agent',
    kind: 'message',
    text: 'Wrote the export',
    detail: null,
    evidenceId: null,
    runId: 'run',
  };
}

const DECISIONS = ['login', 'billing', 'search', 'upload', 'invite'];

function createHome() {
  const now = Date.now();
  return createShinsaState({
    tasks: [
      ...DECISIONS.map((name) =>
        createTask({ id: name, title: `Review the ${name} fix`, stage: 'reviewing' })
      ),
      createTask({
        id: 'build',
        title: 'Build the export',
        stage: 'building',
        activity: [message(now - 60_000)],
      }),
      createTask({ id: 'later', title: 'Ship the export docs', stage: 'queued', waitsOn: ['build'] }),
      createTask({
        id: 'done',
        title: 'Rename the settings page',
        stage: 'merged',
        stageChangedAt: now - 60_000,
      }),
    ],
    gates: DECISIONS.map((name) => createGate({ id: `g-${name}`, taskId: name, kind: 'review' })),
  });
}

function renderHome(state: ShinsaState = createHome()) {
  return render(
    <TooltipProvider>
      <HomePage state={state} />
    </TooltipProvider>
  );
}

function headers() {
  return [...document.querySelectorAll('section > h2 > button')].map(
    (button) => `${button.textContent}|${button.getAttribute('aria-expanded')}`
  );
}

function header(title: RegExp) {
  return screen.getByRole('button', { name: title });
}

beforeEach(() => {
  startFakeServer();
});

afterEach(() => {
  stopFakeServer();
});

describe('HomePage', () => {
  it('orders what needs you, what moves and what just happened above the long tail, every section open', () => {
    renderHome();
    expect(headers()).toEqual([
      'Also needs you1|true',
      'In progress1|true',
      'Recently finished1|true',
      'Recent conversations1|true',
      'Waiting on another task1|true',
    ]);
  });

  it('folds Recently finished and Recent conversations from their headers and remembers them on the next visit', () => {
    const view = renderHome();
    act(() => fireEvent.click(header(/^Recently finished/)));
    act(() => fireEvent.click(header(/^Recent conversations/)));
    expect(screen.queryByRole('button', { name: /Rename the settings page/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Wrote the export/ })).toBeNull();
    expect(localStorage.getItem('shinsa.home-open.finished')).toBe('false');
    expect(localStorage.getItem('shinsa.home-open.conversations')).toBe('false');
    view.unmount();
    renderHome();
    expect(headers()).toEqual([
      'Also needs you1|true',
      'In progress1|true',
      'Recently finished1|false',
      'Recent conversations1|false',
      'Waiting on another task1|true',
    ]);
  });

  it('lists in Also needs you only the decisions the guide above does not name', () => {
    renderHome();
    const guide = screen.getByRole('region', { name: 'What to do now' });
    const named = within(guide)
      .getAllByRole('link', { name: /Review the/ })
      .map((link) => link.textContent);
    const also = screen.getByRole('button', { name: /^Also needs you/ }).closest('section') as HTMLElement;
    const listed = within(also)
      .getAllByRole('button', { name: /Review the/ })
      .map((row) => DECISIONS.find((name) => row.textContent?.includes(`Review the ${name} fix`)));
    expect(named).toHaveLength(4);
    expect(listed).toHaveLength(1);
    expect(named.some((title) => title?.includes(`Review the ${listed[0]} fix`))).toBe(false);
  });

  it('leaves Also needs you out when the guide names every decision', () => {
    const state = createShinsaState({
      tasks: [createTask({ id: 'login', title: 'Review the login fix', stage: 'reviewing' })],
      gates: [createGate({ id: 'g-login', taskId: 'login', kind: 'review' })],
    });
    renderHome(state);
    expect(screen.queryByRole('button', { name: /^Also needs you/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Needs you/ })).toBeNull();
  });

  it('folds the long tail too and keeps it folded', () => {
    const view = renderHome();
    expect(screen.getByRole('button', { name: /Ship the export docs/ })).toBeTruthy();
    act(() => fireEvent.click(header(/^Waiting on another task/)));
    expect(screen.queryByRole('button', { name: /Ship the export docs/ })).toBeNull();
    view.unmount();
    renderHome();
    expect(header(/^Waiting on another task/).getAttribute('aria-expanded')).toBe('false');
  });

  it('shows only the focus project’s work in every section, and follows the focus at once', () => {
    const now = Date.now();
    const project = (id: string, title: string, extra = {}) =>
      createTask({ id, title, repoId: id.startsWith('w') ? 'api' : 'garden', ...extra });
    const state = createShinsaState({
      projects: [createProject({ id: 'work', name: 'Work' }), createProject({ id: 'home', name: 'Home' })],
      repos: [createRepo({ id: 'api', projectId: 'work' }), createRepo({ id: 'garden', projectId: 'home' })],
      tasks: [
        project('w-review', 'Review the login fix', { stage: 'reviewing', handle: 'WK-1' }),
        project('h-review', 'Review the garden plan', { stage: 'reviewing', handle: 'HM-1' }),
        project('w-build', 'Build the export', { stage: 'building', activity: [message(now - 60_000)] }),
        project('h-build', 'Water the beds', { stage: 'building', activity: [message(now - 30_000)] }),
        project('w-done', 'Rename the settings page', {
          stage: 'merged',
          stageChangedAt: now - 60_000,
          handle: 'WK-2',
        }),
        project('h-done', 'Order the seeds', { stage: 'done', stageChangedAt: now - 60_000 }),
      ],
      gates: [
        createGate({ id: 'g-w', taskId: 'w-review', kind: 'review' }),
        createGate({ id: 'g-h', taskId: 'h-review', kind: 'review' }),
      ],
      patch: { focus: { projectId: 'work', until: null } },
    });
    const view = renderHome(state);
    const shows = (title: string) => document.body.textContent?.includes(title) ?? false;
    expect(['Review the login fix', 'Build the export', 'Rename the settings page'].every(shows)).toBe(true);
    expect(['Review the garden plan', 'Water the beds', 'Order the seeds'].some(shows)).toBe(false);
    expect(headers()).toEqual(['In progress1|true', 'Recently finished1|true', 'Recent conversations1|true']);
    expect(screen.getByRole('button', { name: /Rename the settings page/ }).textContent).toContain('WK-2 · ');

    view.rerender(
      <TooltipProvider>
        <HomePage state={{ ...state, focus: { projectId: 'home', until: null } }} />
      </TooltipProvider>
    );
    expect(['Review the garden plan', 'Water the beds', 'Order the seeds'].every(shows)).toBe(true);
    expect(['Review the login fix', 'Build the export', 'Rename the settings page'].some(shows)).toBe(false);

    view.rerender(
      <TooltipProvider>
        <HomePage state={{ ...state, focus: { projectId: null, until: null } }} />
      </TooltipProvider>
    );
    expect(headers()).toEqual(['In progress2|true', 'Recently finished2|true', 'Recent conversations2|true']);
    expect(['Review the login fix', 'Review the garden plan'].every(shows)).toBe(true);
  });
});
