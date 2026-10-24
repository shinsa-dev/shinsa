import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { ShinsaState } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type * as React from 'react';
import { CommandMenu } from '@/components/command/menu.tsx';
import { TaskHeader } from '@/components/task/header.tsx';
import { useTaskView } from '@/hooks/use-task-view.ts';
import { RANK, useRegisterCommands, writeCommandMenuOpen } from '@/lib/command/registry.ts';
import { type LineComment, type ReviewDraft, ReviewDraftContext } from '@/lib/review/draft.ts';
import { navigate } from '@/router.ts';
import { listSentCommands, pushState, startFakeServer, stopFakeServer } from '../../support/server.ts';
import { createGate, createShinsaState, createTask } from '../../support/state.ts';

Element.prototype.scrollIntoView = () => {};

const tasks = [
  createTask({ id: 'login', title: 'Fix the login redirect', updatedAt: 3 }),
  createTask({ id: 'billing', title: 'Rework billing emails', updatedAt: 2 }),
];

function showState(state: ShinsaState = createShinsaState({ tasks })) {
  startFakeServer();
  pushState(state);
}

function renderMenu(extra: React.ReactNode = null) {
  return render(
    <TooltipProvider>
      <input aria-label='Notes' />
      {extra}
      <CommandMenu />
    </TooltipProvider>
  );
}

async function pressCommandK(init: KeyboardEventInit = { metaKey: true }, target: Element | Window = window) {
  const wasOpen = isMenuOpen();
  fireEvent.keyDown(target, { key: 'k', ...init });
  await waitFor(() => expect(isMenuOpen()).toBe(!wasOpen));
}

function isMenuOpen() {
  return document.querySelector('[role="combobox"]') !== null;
}

function input() {
  return screen.getByRole('combobox');
}

function type(text: string) {
  fireEvent.change(input(), { target: { value: text } });
}

function press(key: string) {
  fireEvent.keyDown(input(), { key });
}

async function choose(name: string | RegExp) {
  const option = screen.getByRole('option', { name });
  fireEvent.click(option);
  await waitFor(() => expect(option.isConnected).toBe(false));
}

function optionNames() {
  return screen.getAllByRole('option').map((option) => option.textContent);
}

function selectedOption() {
  return screen.getAllByRole('option').find((option) => option.getAttribute('aria-selected') === 'true')
    ?.textContent;
}

function recentGroup() {
  return document.querySelector('[cmdk-group][data-value="recent"]') as HTMLElement;
}

function headings() {
  return [...document.querySelectorAll('[cmdk-group-heading]')].map((heading) => heading.textContent);
}

beforeEach(() => showState());

afterEach(async () => {
  act(() => writeCommandMenuOpen(false));
  await waitFor(() => expect(isMenuOpen()).toBe(false));
  stopFakeServer();
});

describe('opening the command menu', () => {
  it('opens on Cmd K and closes on the next one', async () => {
    renderMenu();
    await waitFor(() => expect(isMenuOpen()).toBe(false));
    await pressCommandK();
    expect(document.activeElement).toBe(input());
    await pressCommandK();
    await waitFor(() => expect(isMenuOpen()).toBe(false));
  });

  it('opens on Ctrl K while another input has focus', async () => {
    renderMenu();
    const notes = screen.getByLabelText('Notes');
    notes.focus();
    await pressCommandK({ ctrlKey: true }, notes);
    expect(input()).toBeTruthy();
  });

  it('ignores K without a modifier and with Shift or Alt held', () => {
    renderMenu();
    for (const init of [{}, { metaKey: true, shiftKey: true }, { ctrlKey: true, altKey: true }]) {
      fireEvent.keyDown(window, { key: 'k', ...init });
    }
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('renders nothing before the first state arrives', () => {
    startFakeServer();
    pushState(null as unknown as ShinsaState);
    renderMenu();
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});

describe('typing in the root', () => {
  it('filters by word and keeps the new task rows at the bottom', async () => {
    renderMenu();
    await pressCommandK();
    await type('all tasks');
    expect(optionNames()).toEqual(['All tasks', 'Create task:all tasks', 'Edit it before starting']);
  });

  it('finds a task by a word from its title', async () => {
    renderMenu();
    await pressCommandK();
    await type('billing');
    expect(optionNames()).toEqual([
      'Rework billing emailsBuilding',
      'Create task:billing',
      'Edit it before starting',
    ]);
  });

  it('opens All tasks on Enter and closes', async () => {
    renderMenu();
    await pressCommandK();
    await type('all tasks');
    await press('Enter');
    expect(location.pathname).toBe('/tasks');
    await waitFor(() => expect(isMenuOpen()).toBe(false));
  });

  it('creates a task from what was typed', async () => {
    renderMenu();
    await pressCommandK();
    await type('  Add a dark mode toggle  ');
    await choose(/Create task:/);
    expect(listSentCommands()).toEqual([
      { type: 'task.create', request: 'Add a dark mode toggle', repoId: null },
    ]);
    await waitFor(() => expect(isMenuOpen()).toBe(false));
  });
});

describe('recent tasks', () => {
  it('lists a task opened on its handle URL once you are elsewhere', async () => {
    showState(
      createShinsaState({
        tasks: [
          createTask({ id: 'login', handle: 'SW-1', title: 'Fix the login redirect', updatedAt: 3 }),
          createTask({ id: 'billing', title: 'Rework billing emails', updatedAt: 2 }),
        ],
      })
    );
    act(() => navigate('/tasks/SW-1'));
    renderMenu();
    act(() => navigate('/'));
    await pressCommandK();
    expect(headings()).toContain('Recent');
    expect(
      within(recentGroup())
        .getAllByRole('option')
        .map((option) => option.textContent)
    ).toEqual(['Fix the login redirectSW-1Building']);
  });
});

describe('pages', () => {
  it('opens a choice on its current value with the crumb in the input', async () => {
    localStorage.setItem('shinsa.theme', 'dark');
    renderMenu();
    await pressCommandK();
    await type('change theme');
    await choose(/^Change theme/);
    expect(within(input().parentElement as HTMLElement).getByText('Theme')).toBeTruthy();
    expect(input().getAttribute('placeholder')).toBe('Change theme…');
    expect(optionNames()).toEqual(['System', 'Light', 'Dark']);
    await waitFor(() => expect(selectedOption()).toBe('Dark'));
  });

  it('applies the option picked on a choice page', async () => {
    renderMenu();
    await pressCommandK();
    await type('change theme');
    await choose(/^Change theme/);
    await choose('Light');
    expect(localStorage.getItem('shinsa.theme')).toBe('light');
    await waitFor(() => expect(isMenuOpen()).toBe(false));
  });

  it('jumps to a task through the Tasks page, opening on the first task', async () => {
    renderMenu();
    await pressCommandK();
    await choose(/^Jump to a task/);
    expect(within(input().parentElement as HTMLElement).getByText('Tasks')).toBeTruthy();
    expect(selectedOption()).toBe('Fix the login redirect');
    await choose('Fix the login redirect');
    expect(within(input().parentElement as HTMLElement).getByText('Fix the login redirect')).toBeTruthy();
    expect(headings()).toEqual(['Open', 'Task']);
  });

  it('goes back on Backspace in an empty input and re-selects the row that opened the page', async () => {
    renderMenu();
    await pressCommandK();
    await choose(/^Jump to a task/);
    await press('Backspace');
    expect(input().getAttribute('placeholder')).toBe('Search tasks and actions, or describe a new task…');
    expect(selectedOption()).toMatch(/^Jump to a task/);
  });

  it('keeps the page while Backspace edits the query', async () => {
    renderMenu();
    await pressCommandK();
    await choose(/^Jump to a task/);
    await type('bill');
    await press('Backspace');
    expect(input().getAttribute('placeholder')).toBe('Jump to a task…');
  });

  it('resets to the root when closed', async () => {
    renderMenu();
    await pressCommandK();
    await choose(/^Jump to a task/);
    await type('bill');
    await pressCommandK();
    await pressCommandK();
    expect(input().getAttribute('placeholder')).toBe('Search tasks and actions, or describe a new task…');
    expect((input() as HTMLInputElement).value).toBe('');
  });

  it('keeps its page and query while it closes', async () => {
    renderMenu();
    await pressCommandK();
    await choose(/^Jump to a task/);
    await type('bill');
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect((input() as HTMLInputElement).value).toBe('bill');
    expect(input().getAttribute('placeholder')).toBe('Jump to a task…');
    await waitFor(() => expect(isMenuOpen()).toBe(false));
  });
});

describe('sections a page registers', () => {
  function Checks({ run }: { run: () => void }) {
    useRegisterCommands([
      {
        id: 'checks',
        heading: 'Checks',
        rank: RANK.context,
        commands: [{ kind: 'run', id: 'checks.run', label: 'Run the checks', run }],
      },
    ]);
    return null;
  }

  it('appear first while the page is mounted and disappear after', async () => {
    const run = mock();
    const view = renderMenu(<Checks run={run} />);
    await pressCommandK();
    expect(headings()[0]).toBe('Checks');
    await pressCommandK();
    view.rerender(
      <TooltipProvider>
        <input aria-label='Notes' />
        <CommandMenu />
      </TooltipProvider>
    );
    await pressCommandK();
    expect(headings()).not.toContain('Checks');
    expect(screen.queryByRole('option', { name: 'Run the checks' })).toBeNull();
  });

  it('runs a registered command after the menu closes', async () => {
    const run = mock();
    renderMenu(<Checks run={run} />);
    await pressCommandK();
    await choose('Run the checks');
    expect(run).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(isMenuOpen()).toBe(false));
  });
});

describe('on a task page', () => {
  const reviewState = createShinsaState({
    tasks: [
      createTask({
        id: 'login',
        title: 'Fix the login redirect',
        stage: 'reviewing',
        worktreePath: '/tmp/wt',
      }),
      ...tasks.slice(1),
    ],
    gates: [createGate({ id: 'review', taskId: 'login', type: 'review' })],
  });

  function Header({ state, comments }: { state: ShinsaState; comments: LineComment[] }) {
    const view = useTaskView(state, 'login');
    const draft: ReviewDraft = {
      enabled: true,
      comments,
      addComment: () => {},
      removeComment: () => {},
      clearComments: () => {},
    };
    return (
      <ReviewDraftContext.Provider value={draft}>
        {view.task && <TaskHeader state={state} task={view.task} view={view} />}
      </ReviewDraftContext.Provider>
    );
  }

  function renderTaskPage(comments: LineComment[] = []) {
    history.replaceState(null, '', '/tasks/login');
    dispatchEvent(new PopStateEvent('popstate'));
    showState(reviewState);
    renderMenu(<Header state={reviewState} comments={comments} />);
  }

  it('leads with the task decision', async () => {
    renderTaskPage();
    await pressCommandK();
    expect(input().getAttribute('placeholder')).toBe('Act on this task, jump to another, or type a new one…');
    expect(headings()[0]).toBe('Decide on this task');
    expect(optionNames().slice(0, 3)).toEqual([
      'Approve the changesOpens the pull request',
      'Review the changes',
      'Request changes',
    ]);
    expect(selectedOption()).toBe('Approve the changesOpens the pull request');
  });

  it('approves the changes through the same command as the button', async () => {
    renderTaskPage();
    await pressCommandK();
    await choose(/^Approve the changes/);
    expect(listSentCommands()).toEqual([
      { type: 'gate.answer', gateId: 'review', decision: 'approve', response: null },
    ]);
  });

  it('disables Approve the changes while line comments exist', async () => {
    renderTaskPage([
      {
        id: 'c1',
        path: 'src/login.ts',
        side: 'new',
        line: 4,
        endLine: null,
        ref: null,
        text: 'Keep the return path',
        suggestion: null,
      },
    ]);
    await pressCommandK();
    const approve = screen.getByRole('option', { name: /^Approve the changes/ });
    expect(approve.getAttribute('aria-disabled')).toBe('true');
    expect(approve.textContent).toContain('Send or clear your comments first');
    expect(optionNames()).toContain('Request changes with 1 comment');
    fireEvent.click(approve);
    expect(listSentCommands()).toEqual([]);
  });
});
