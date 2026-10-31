import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { ShinsaState, Task } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { TaskQueue } from '@/components/queue/queue.tsx';
import { createDisclosureId, readDisclosure, writeDisclosure } from '@/lib/preferences/disclosure.ts';
import { createAgentEntry, createCallEntry } from '../../support/chat.ts';
import { pushTranscript, startFakeServer, stopFakeServer } from '../../support/server.ts';
import {
  createGate,
  createProject,
  createRepo,
  createRun,
  createShinsaState,
  createTask,
  NOW,
} from '../../support/state.ts';

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
    expect(readDisclosure(createDisclosureId('queue', 'section', 'waiting'))).toBe(true);
    act(() => fireEvent.click(header(/^Needs you/)));
    expect(isOpen(/^Needs you/)).toBe(false);
    expect(screen.queryByRole('button', { name: /Review the login fix/ })).toBeNull();
    expect(readDisclosure(createDisclosureId('queue', 'section', 'needs'))).toBe(false);
  });

  it('keeps a closed choice over the open default for the task on screen', () => {
    writeDisclosure(createDisclosureId('queue', 'section', 'waiting'), false);
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
    writeDisclosure(createDisclosureId('queue', 'section', 'waiting'), true);
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
    writeDisclosure(createDisclosureId('queue', 'section', 'working'), false);
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

describe('a row’s summary line', () => {
  beforeEach(() => {
    startFakeServer();
  });

  afterEach(() => {
    stopFakeServer();
  });

  function plan(titles: string[]) {
    return {
      version: 1,
      document: {
        goal: '',
        phases: titles.map((title) => ({ title, detail: title })),
        behaviour: [],
        approach: '',
        files: [],
        outOfScope: [],
        verification: [],
        questions: [],
      },
    } as unknown as Task['plan'];
  }

  const BUILDING = createTask({
    id: 'build',
    title: 'Build the export',
    stage: 'building',
    pipeline: ['plan', 'build', 'checks', 'your_review'],
    plan: plan(['Set up', 'Wire the form']),
    phases: [
      { status: 'done', at: NOW },
      { status: 'active', at: NOW },
    ],
  });

  function row(title: RegExp) {
    return screen.getByRole('button', { name: title });
  }

  it('shows where the task is in its steps and the agent’s latest action', () => {
    renderQueue({
      variant: 'wide',
      state: createShinsaState({
        tasks: [BUILDING],
        runs: [createRun({ id: 'run-build', taskId: 'build', purpose: 'build' })],
      }),
    });
    pushTranscript('run-build', [
      createCallEntry('call-1', {
        kind: 'command',
        action: 'run',
        command: 'bun test apps/web',
        description: null,
      }),
    ]);
    expect(
      within(row(/Build the export/))
        .getByRole('img', { name: /^Step/ })
        .getAttribute('aria-label')
    ).toBe('Step 2 of 4: Build 1/2');
    expect(row(/Build the export/).textContent).not.toContain('Wire the form');
    expect(row(/Build the export/).textContent).toContain('Running bun test apps/web');
  });

  it('shows nothing after the steps in the compact queue', () => {
    renderQueue({
      variant: 'compact',
      state: createShinsaState({
        tasks: [BUILDING],
        runs: [createRun({ id: 'run-popover', taskId: 'build', purpose: 'build' })],
      }),
    });
    pushTranscript('run-popover', [
      createCallEntry('call-1', {
        kind: 'command',
        action: 'run',
        command: 'bun test apps/web',
        description: null,
      }),
    ]);
    expect(row(/Build the export/).textContent).toBe('Build the exportBuilding');
  });

  it('names the current step until the agent has done anything', () => {
    renderQueue({
      variant: 'wide',
      state: createShinsaState({
        tasks: [BUILDING],
        runs: [createRun({ id: 'run-quiet', taskId: 'build', purpose: 'build' })],
      }),
    });
    expect(row(/Build the export/).textContent).toContain('Build 1/2');
  });

  it('names the current step’s count when no agent runs, and nothing when it has none', () => {
    renderQueue({
      variant: 'wide',
      state: createShinsaState({
        tasks: [
          BUILDING,
          createTask({ id: 'triaged', title: 'Fresh task', stage: 'building', pipeline: ['build'] }),
        ],
      }),
    });
    expect(row(/Build the export/).textContent).toContain('Build 1/2');
    expect(row(/Fresh task/).textContent).toStartWith('Fresh taskBuilding');
    expect(row(/Fresh task/).textContent).not.toContain('Build ');
    expect(
      within(row(/Fresh task/))
        .getByRole('img', { name: /^Step/ })
        .getAttribute('aria-label')
    ).toBe('Step 2 of 2: Build');
  });

  it('names the step instead of the agent’s action while it waits on you', () => {
    renderQueue({
      variant: 'wide',
      state: createShinsaState({
        tasks: [BUILDING],
        runs: [createRun({ id: 'run-ask', taskId: 'build', purpose: 'build' })],
        gates: [createGate({ id: 'g-ask', taskId: 'build', type: 'question', runId: 'run-ask' })],
      }),
    });
    pushTranscript('run-ask', [createAgentEntry('Which export format?', 'interim')]);
    expect(row(/Build the export/).textContent).not.toContain('Which export format?');
    expect(row(/Build the export/).textContent).toContain('Build 1/2');
  });

  it('shimmers a waiting agent’s action too', () => {
    renderQueue({
      variant: 'wide',
      state: createShinsaState({
        tasks: [BUILDING],
        runs: [createRun({ id: 'run-wait', taskId: 'build', purpose: 'build', status: 'waiting' })],
      }),
    });
    pushTranscript('run-wait', [createAgentEntry('Waiting on the planner.', 'interim')]);
    expect(row(/Build the export/).textContent).toContain('Waiting on the planner.');
    expect(row(/Build the export/).querySelectorAll('[data-char]')).toHaveLength('Waiting on the planner.'.length);
  });

  it('says the steps are still being worked out while triage shapes the task', () => {
    renderQueue({
      variant: 'wide',
      state: createShinsaState({
        tasks: [
          createTask({
            id: 'shaping',
            title: 'Shape me',
            stage: 'waiting_on_tasks',
            waitsOn: ['build'],
            auto: { shape: true, start: false, priority: false },
            pipeline: [],
          }),
          BUILDING,
        ],
      }),
    });
    expect(row(/Shape me/).textContent).toContain('Working out the steps');
  });

  it('shows the planning agent’s latest action while it can still change the steps', () => {
    renderQueue({
      variant: 'wide',
      state: createShinsaState({
        tasks: [
          createTask({
            id: 'planning',
            title: 'Plan the export',
            stage: 'planning',
            auto: { shape: true, start: false, priority: false },
            pipeline: ['plan', 'build'],
          }),
        ],
        runs: [createRun({ id: 'run-plan', taskId: 'planning', purpose: 'plan' })],
      }),
    });
    expect(row(/Plan the export/).textContent).toContain('Working out the steps');
    pushTranscript('run-plan', [
      createCallEntry('call-1', { kind: 'command', action: 'run', command: 'rg foo', description: null }),
    ]);
    expect(row(/Plan the export/).textContent).toContain('Running rg foo');
    expect(row(/Plan the export/).textContent).not.toContain('Working out the steps');
  });
});
