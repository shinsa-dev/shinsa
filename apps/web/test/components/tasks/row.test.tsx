import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { SHARE_PRESET_SCOPES } from '@shinsa/core';
import type { ShinsaState, Task } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TaskRowState } from '@/components/tasks/row-state.tsx';
import { describeChainDepth, resolveDepthIndent, TaskListRow } from '@/components/tasks/row.tsx';
import { resolveTaskRowModel } from '@/lib/tasks/row-model.ts';
import { findTooltipText } from '../../support/hover.ts';
import { listSentCommands, pushState, startFakeServer, stopFakeServer } from '../../support/server.ts';
import { createProject, createRepo, createShinsaState, createTask } from '../../support/state.ts';

const STATE = createShinsaState({
  tasks: [
    createTask({ id: 'base', title: 'Build the search index', stage: 'building' }),
    createTask({
      id: 'docs',
      title: 'Ship search docs',
      stage: 'waiting_on_tasks',
      waitsOn: ['base'],
      branch: 'docs/search',
      worktreePath: '/tmp/docs',
    }),
    createTask({ id: 'other', title: 'Tidy the settings page', stage: 'building' }),
    createTask({ id: 'shipped', title: 'Rename the settings page', stage: 'merged' }),
  ],
});

function renderRow(task: Task, depth = 0, state: ShinsaState = STATE) {
  return render(
    <TooltipProvider>
      <TaskRowState state={state}>
        <TaskListRow model={resolveTaskRowModel(state, task, depth)} />
      </TaskRowState>
    </TooltipProvider>
  );
}

function row() {
  const found = screen.getAllByRole('button').find((button) => button.tagName === 'DIV');
  if (!found) throw new Error('No row');
  return found;
}

function findTask(id: string) {
  const found = STATE.tasks[id];
  if (!found) throw new Error(`No task ${id}`);
  return found;
}

async function openContextMenu() {
  fireEvent.contextMenu(row());
  await screen.findByRole('menu');
}

function menuItems() {
  return [...document.querySelectorAll('[role^="menuitem"]')].map((item) => item.textContent);
}

beforeEach(() => {
  startFakeServer();
  pushState(STATE);
});

afterEach(stopFakeServer);

describe('the row context menu', () => {
  it('offers Open task, priority, dependencies and the task actions', async () => {
    renderRow(findTask('docs'), 1);
    await openContextMenu();
    expect(menuItems()).toEqual([
      'Open task',
      'Urgent',
      'High',
      'Normal',
      'Low',
      'Wait for another task',
      'Stop waiting',
      'Stack on another task',
      'Make an initiative from this task',
      'Copy branch name',
      'Open in editor',
      'Open a terminal',
      'Show in Finder',
      'Fork into a new task',
      'Share task',
      'Move to the backlog',
      'Snooze',
      'Restart the current step',
      'Mark as done',
      'Close as a duplicate',
      'Cancel task',
    ]);
  });

  it('opens the task', async () => {
    renderRow(findTask('docs'), 1);
    await openContextMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open task' }));
    await waitFor(() => expect(location.pathname).toBe('/tasks/docs'));
  });

  it('changes the priority', async () => {
    renderRow(findTask('docs'), 1);
    await openContextMenu();
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'High' }));
    await waitFor(() =>
      expect(listSentCommands()).toEqual([{ type: 'task.prioritize', taskId: 'docs', priority: 'high' }])
    );
  });

  it('stops waiting', async () => {
    renderRow(findTask('docs'), 1);
    await openContextMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Stop waiting' }));
    await waitFor(() =>
      expect(listSentCommands()).toEqual([{ type: 'task.wait_on', taskId: 'docs', waitsOn: [] }])
    );
  });

  it('cancels the task', async () => {
    renderRow(findTask('docs'), 1);
    await openContextMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Cancel task' }));
    await waitFor(() => expect(listSentCommands()).toEqual([{ type: 'task.cancel', taskId: 'docs' }]));
  });

  it('offers only Open task, forking and sharing on a settled task without a branch', async () => {
    renderRow(findTask('shipped'));
    await openContextMenu();
    expect(menuItems()).toEqual([
      'Open task',
      'Make an initiative from this task',
      'Fork into a new task',
      'Share task',
    ]);
  });
});

describe('the chain arrow', () => {
  it('opens the Waits on menu without opening the task', async () => {
    renderRow(findTask('docs'), 1);
    fireEvent.click(screen.getByRole('button', { name: 'Waits on' }));
    expect(await screen.findByText('Starts when this finishes')).toBeTruthy();
    expect(location.pathname).toBe('/');
    expect(screen.getByRole('menuitem', { name: /Build the search index/ })).toBeTruthy();
  });

  it('is only on a nested row', () => {
    const view = renderRow(findTask('docs'), 0);
    expect(screen.queryByRole('button', { name: 'Waits on' })).toBeNull();
    view.unmount();
    renderRow(findTask('docs'), 1);
    expect(screen.getByRole('button', { name: 'Waits on' })).toBeTruthy();
  });

  it('opens a parent from the Waits on menu without opening the nested task', async () => {
    renderRow(findTask('docs'), 1);
    fireEvent.click(screen.getByRole('button', { name: 'Waits on' }));
    expect(await screen.findByText('Starts when this finishes')).toBeTruthy();
    expect(location.pathname).toBe('/');
    fireEvent.click(screen.getByRole('menuitem', { name: /Build the search index/ }));
    await waitFor(() => expect(location.pathname).toBe('/tasks/base'));
  });

  it('keeps the task closed when Enter lands on the arrow', () => {
    renderRow(findTask('docs'), 1);
    const arrow = screen.getByRole('button', { name: 'Waits on' });
    act(() => arrow.focus());
    fireEvent.keyDown(arrow, { key: 'Enter' });
    expect(location.pathname).toBe('/');
  });
});

describe('the depth of a row', () => {
  it('indents every level of a long line, so a line never reads as tasks side by side', () => {
    const indents = [1, 2, 3, 4, 5, 6].map(resolveDepthIndent);
    expect(new Set(indents).size).toBe(indents.length);
    expect(resolveDepthIndent(9)).toBe(resolveDepthIndent(6));
  });

  it('marks a row deeper than the indent shows with its depth, named on hover', async () => {
    renderRow(findTask('docs'), 9);
    expect(row().dataset.depth).toBe('9');
    expect(await findTooltipText(screen.getByText('9'))).toBe('9 steps down the chain');
    expect(describeChainDepth(6)).toBeNull();
  });
});

describe('a task stacked on another', () => {
  const root = createTask({
    id: 'root',
    handle: 'SW-32',
    title: 'Add the saved cart schema',
    stage: 'shipping',
  });
  const stacked = createTask({
    id: 'stacked',
    title: 'Serve saved carts over the API',
    stage: 'waiting_on_tasks',
    stacksOn: ['root'],
  });
  const state = createShinsaState({ tasks: [root, stacked] });

  it('marks its bundle instead of a wait, and links the task below', async () => {
    renderRow(stacked, 1, state);
    expect(screen.queryByRole('button', { name: 'Waits on' })).toBeNull();
    const mark = screen.getByRole('link', { name: 'Stacked on SW-32' });
    expect(await findTooltipText(mark)).toContain('Merges with its bundle');
    fireEvent.click(mark);
    await waitFor(() => expect(location.pathname).toBe('/tasks/SW-32'));
  });

  it('says Stacked on in its status while the task below is open', () => {
    renderRow(stacked, 1, state);
    expect(row().textContent).toContain('Stacked on SW-32');
    expect(row().textContent).not.toContain('Waits on');
  });
});

describe('a task stacked on several tasks', () => {
  const left = createTask({
    id: 'left',
    handle: 'SW-33',
    title: 'Sync plans from the App Store',
    stage: 'shipping',
  });
  const right = createTask({
    id: 'right',
    handle: 'SW-34',
    title: 'Sync plans from Google Play',
    stage: 'shipping',
  });
  const join = createTask({
    id: 'join',
    title: 'Resolve entitlements across stores',
    stage: 'waiting_on_tasks',
    stacksOn: ['left', 'right'],
    waitsOn: ['left', 'right'],
  });
  const state = createShinsaState({ tasks: [left, right, join] });

  it('marks its bundle once, naming every task it stacks on', async () => {
    renderRow(join, 1, state);
    const mark = screen.getByRole('link', { name: 'Stacked on SW-33 and 1 more' });
    const tooltip = await findTooltipText(mark);
    expect(tooltip).toContain('Sync plans from the App Store');
    expect(tooltip).toContain('Sync plans from Google Play');
    expect(row().textContent).toContain('Stacked on SW-33');
  });
});

describe('a task stacked on another that also waits on others', () => {
  const root = createTask({
    id: 'root',
    handle: 'SW-32',
    title: 'Add the saved cart schema',
    stage: 'shipping',
  });
  const other = createTask({
    id: 'other',
    handle: 'SW-40',
    title: 'Migrate the cart table',
    stage: 'building',
  });
  const stacked = createTask({
    id: 'stacked',
    title: 'Serve saved carts over the API',
    stage: 'waiting_on_tasks',
    stacksOn: ['root'],
    waitsOn: ['root', 'other'],
  });
  const state = createShinsaState({ tasks: [root, other, stacked] });

  it('keeps the menu of every parent, marked as its bundle', async () => {
    renderRow(stacked, 1, state);
    expect(screen.queryByRole('link', { name: 'Stacked on SW-32' })).toBeNull();
    const mark = screen.getByRole('button', { name: 'Stacked on SW-32, waits on 1 more' });
    const tooltip = await findTooltipText(mark);
    expect(tooltip).toContain('Merges with its bundle');
    expect(tooltip).toContain('Migrate the cart table');
    fireEvent.click(mark);
    expect(await screen.findByRole('menuitem', { name: /Migrate the cart table/ })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /Add the saved cart schema/ })).toBeTruthy();
  });
});

describe('the repository column', () => {
  it('says No repository for a task that works without one', () => {
    renderRow(createTask({ id: 'research', title: 'Compare the search engines', stage: 'researching' }));
    expect(screen.getByText('No repository')).toBeTruthy();
  });

  it('names the repository beside its GitHub mark in its project’s colour, the project on hover', async () => {
    const state = createShinsaState({
      tasks: [createTask({ id: 'web', title: 'Fix the paywall', repoId: 'web' })],
      projects: [createProject({ id: 'p', name: 'Superwall', color: 'purple' })],
      repos: [
        createRepo({ id: 'web', name: 'paywall-next', projectId: 'p', remote: 'git@github.com:sw/web.git' }),
      ],
    });
    const view = renderRow(state.tasks.web as Task, 0, state);
    const ink = view.container.querySelector('[data-project-ink]') as SVGElement;
    expect(ink.getAttribute('data-project-ink')).toBe('purple');
    expect(screen.getByText('paywall-next')).toBeTruthy();
    expect(await findTooltipText(ink.parentElement as HTMLElement)).toBe('Superwall project');
  });

  it('leaves a repository with no project its plain mark and no hint', () => {
    const state = createShinsaState({
      tasks: [createTask({ id: 'loose', title: 'Try a thing', repoId: 'scratch' })],
      repos: [createRepo({ id: 'scratch', name: 'scratch' })],
    });
    const view = renderRow(state.tasks.loose as Task, 0, state);
    expect(view.container.querySelector('[data-project-ink]')).toBeNull();
    expect(screen.getByText('scratch')).toBeTruthy();
  });
});

describe('the kind of task', () => {
  it('marks every row with its kind, and its tooltip lists the steps the task takes', async () => {
    const task = createTask({
      id: 'probe',
      title: 'Why exports stall',
      stage: 'investigating',
      pipeline: ['investigate'],
    });
    renderRow(task);
    expect(await findTooltipText(screen.getByRole('img', { name: 'Investigation' }))).toBe(
      'Investigation: find the repository, then investigate.'
    );
  });
});

describe('a shared task in the list', () => {
  it('shows a shared mark beside its title, and none when it is not shared', () => {
    const shared = createTask({
      id: 'shared',
      title: 'Share the search page',
      stage: 'building',
      share: {
        at: 1,
        limit: 'until_done',
        scopes: SHARE_PRESET_SCOPES.standard,
        endsAt: null,
        url: 'https://app.shinsa.dev/share/t/abc',
      },
    });
    const { unmount } = renderRow(shared);
    expect(screen.getByRole('img', { name: 'Shared by link' })).toBeTruthy();
    unmount();
    renderRow(createTask({ id: 'plain', stage: 'building' }));
    expect(screen.queryByRole('img', { name: 'Shared by link' })).toBeNull();
  });
});
