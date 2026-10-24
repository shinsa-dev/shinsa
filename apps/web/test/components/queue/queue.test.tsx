import { describe, expect, it, mock } from 'bun:test';
import type { ShinsaState } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { TaskQueue } from '@/components/queue/queue.tsx';
import { createGate, createProject, createRepo, createShinsaState, createTask } from '../../support/state.ts';

const FULL = createShinsaState({
  projects: [createProject({ id: 'work', name: 'Work' }), createProject({ id: 'home', name: 'Home' })],
  repos: [createRepo({ id: 'api', projectId: 'work' }), createRepo({ id: 'garden', projectId: 'home' })],
  tasks: [
    createTask({ id: 'review', title: 'Review the login fix', repoId: 'api', stage: 'reviewing' }),
    createTask({ id: 'merge', title: 'Merge the billing change', repoId: 'api', stage: 'awaiting_merge' }),
    createTask({ id: 'build', title: 'Build the export', repoId: 'api', stage: 'building' }),
    createTask({
      id: 'later',
      title: 'Ship the export docs',
      repoId: 'api',
      stage: 'waiting_on_tasks',
      waitsOn: ['build'],
    }),
    createTask({ id: 'garden', title: 'Plan the garden beds', repoId: 'garden', stage: 'reviewing' }),
  ],
  gates: [
    createGate({ id: 'g-review', taskId: 'review', type: 'review' }),
    createGate({ id: 'g-merge', taskId: 'merge', type: 'merge', title: 'Merge #12' }),
    createGate({ id: 'g-garden', taskId: 'garden', type: 'review' }),
  ],
  patch: { focus: { projectId: 'work', until: null } },
});

function renderQueue(props: Partial<React.ComponentProps<typeof TaskQueue>> & { state?: ShinsaState } = {}) {
  const { state = FULL, variant = 'compact', ...rest } = props;
  return render(
    <TooltipProvider>
      <TaskQueue state={state} variant={variant} {...rest} />
    </TooltipProvider>
  );
}

function toggles() {
  return screen
    .queryAllByRole('button', { expanded: true })
    .concat(screen.queryAllByRole('button', { expanded: false }));
}

function header(title: RegExp) {
  return screen.getByRole('button', { name: title });
}

function isOpen(title: RegExp) {
  return header(title).getAttribute('aria-expanded') === 'true';
}

const TITLES = [
  'Review the login fix',
  'Merge the billing change',
  'Build the export',
  'Ship the export docs',
  'Plan the garden beds',
];

function rowTitles() {
  return [...document.querySelectorAll('[data-highlight-item]')].map((row) =>
    TITLES.find((title) => row.textContent?.startsWith(title))
  );
}

function sectionTitles() {
  return [...document.querySelectorAll('section')].map(
    (section) => (section.querySelector('button, h2') as HTMLElement).textContent
  );
}

describe('compact queue', () => {
  it('lists the focus project’s sections in order with Waiting collapsed, and nothing from other projects', () => {
    renderQueue();
    expect(sectionTitles()).toEqual(['Needs you2', 'In progress1', 'Waiting on another task1']);
    expect(isOpen(/^Needs you/)).toBe(true);
    expect(isOpen(/^In progress/)).toBe(true);
    expect(isOpen(/^Waiting on another task/)).toBe(false);
    expect(rowTitles()).toEqual(['Merge the billing change', 'Review the login fix', 'Build the export']);
    expect(toggles()).toHaveLength(3);
    expect(screen.queryByText('Plan the garden beds')).toBeNull();
  });

  it('opens a collapsed section that holds the task on screen', () => {
    renderQueue({ activeTaskId: 'later' });
    expect(isOpen(/^Waiting on another task/)).toBe(true);
    expect(screen.getByRole('button', { name: /Ship the export docs/ }).getAttribute('aria-current')).toBe(
      'true'
    );
  });

  it('toggles a section from its header and remembers it', () => {
    renderQueue();
    act(() => fireEvent.click(header(/^Waiting on another task/)));
    expect(isOpen(/^Waiting on another task/)).toBe(true);
    expect(localStorage.getItem('shinsa.queue-open.waiting')).toBe('true');
    act(() => fireEvent.click(header(/^Needs you/)));
    expect(isOpen(/^Needs you/)).toBe(false);
    expect(screen.queryByRole('button', { name: /Review the login fix/ })).toBeNull();
    expect(localStorage.getItem('shinsa.queue-open.needs')).toBe('false');
  });

  it('keeps a closed choice over the open default for the task on screen', () => {
    localStorage.setItem('shinsa.queue-open.waiting', 'false');
    renderQueue({ activeTaskId: 'later' });
    expect(isOpen(/^Waiting on another task/)).toBe(false);
  });

  it('says so when nothing waits on you and no agent works', () => {
    renderQueue({ state: createShinsaState({}) });
    expect(sectionTitles()).toEqual(['Needs you0', 'In progress0']);
    expect(screen.getByText('Nothing is waiting on you.')).toBeTruthy();
    expect(screen.getByText('No agent is working right now.')).toBeTruthy();
  });

  it('lists waiting tasks in chain order rather than by priority', () => {
    localStorage.setItem('shinsa.queue-open.waiting', 'true');
    renderQueue({
      state: createShinsaState({
        tasks: [
          createTask({ id: 'build', title: 'Build the export', stage: 'building' }),
          createTask({
            id: 'docs',
            title: 'Ship the export docs',
            stage: 'waiting_on_tasks',
            waitsOn: ['build'],
          }),
          createTask({
            id: 'garden',
            title: 'Plan the garden beds',
            stage: 'waiting_on_tasks',
            waitsOn: ['docs'],
            priority: 'urgent',
          }),
        ],
      }),
    });
    expect(rowTitles()).toEqual(['Build the export', 'Ship the export docs', 'Plan the garden beds']);
  });

  it('opens the task from a row', () => {
    const onNavigate = mock();
    renderQueue({ onNavigate });
    act(() => fireEvent.click(screen.getByRole('button', { name: /Review the login fix/ })));
    expect(location.pathname).toBe('/tasks/review');
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });
});

describe('wide queue', () => {
  it('lists the same sections in order, every one open until you fold it', () => {
    renderQueue({ variant: 'wide' });
    expect(sectionTitles()).toEqual(['Needs you2', 'In progress1', 'Waiting on another task1']);
    expect(isOpen(/^Needs you/)).toBe(true);
    expect(isOpen(/^In progress/)).toBe(true);
    expect(isOpen(/^Waiting on another task/)).toBe(true);
  });

  it('keeps its open sections apart from the compact queue', () => {
    localStorage.setItem('shinsa.queue-open.working', 'false');
    const view = renderQueue({ variant: 'wide' });
    expect(isOpen(/^In progress/)).toBe(true);
    act(() => fireEvent.click(header(/^Needs you/)));
    view.unmount();
    renderQueue();
    expect(isOpen(/^Needs you/)).toBe(true);
    expect(isOpen(/^In progress/)).toBe(false);
  });

  it('shows the age of each row, which the compact queue leaves out', () => {
    const view = renderQueue({ variant: 'wide' });
    expect(screen.getByRole('button', { name: /Review the login fix/ }).querySelector('time')).not.toBeNull();
    view.unmount();
    renderQueue();
    expect(screen.getByRole('button', { name: /Review the login fix/ }).querySelector('time')).toBeNull();
  });
});
