import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { ShinsaState, Task } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RoadmapRow } from '@/components/roadmap/row.tsx';
import type { RoadmapGroupKey } from '@/lib/tasks/roadmap.ts';
import { findTooltipText } from '../../support/hover.ts';
import { listSentCommands, pushState, startFakeServer, stopFakeServer } from '../../support/server.ts';
import { createShinsaState, createTask } from '../../support/state.ts';

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

function renderRow(task: Task, group: RoadmapGroupKey, depth = 0, state: ShinsaState = STATE) {
  return render(
    <TooltipProvider>
      <RoadmapRow state={state} task={task} group={group} depth={depth} />
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
    renderRow(findTask('docs'), 'waiting', 1);
    await openContextMenu();
    expect(menuItems()).toEqual([
      'Open task',
      'Urgent',
      'High',
      'Normal',
      'Low',
      'Wait for another task',
      'Stop waiting',
      'Copy branch name',
      'Open in editor',
      'Open a terminal',
      'Show in Finder',
      'Restart the current step',
      'Mark as done',
      'Cancel task',
    ]);
  });

  it('opens the task', async () => {
    renderRow(findTask('docs'), 'waiting', 1);
    await openContextMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open task' }));
    await waitFor(() => expect(location.pathname).toBe('/tasks/docs'));
  });

  it('changes the priority', async () => {
    renderRow(findTask('docs'), 'waiting', 1);
    await openContextMenu();
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'High' }));
    await waitFor(() =>
      expect(listSentCommands()).toEqual([{ type: 'task.prioritize', taskId: 'docs', priority: 'high' }])
    );
  });

  it('stops waiting', async () => {
    renderRow(findTask('docs'), 'waiting', 1);
    await openContextMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Stop waiting' }));
    await waitFor(() =>
      expect(listSentCommands()).toEqual([{ type: 'task.wait_on', taskId: 'docs', waitsOn: [] }])
    );
  });

  it('cancels the task', async () => {
    renderRow(findTask('docs'), 'waiting', 1);
    await openContextMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Cancel task' }));
    await waitFor(() => expect(listSentCommands()).toEqual([{ type: 'task.cancel', taskId: 'docs' }]));
  });

  it('offers only Open task on a settled task without a branch', async () => {
    renderRow(findTask('shipped'), 'done');
    await openContextMenu();
    expect(menuItems()).toEqual(['Open task']);
  });
});

describe('the chain arrow', () => {
  it('opens the Waits on menu without opening the task', async () => {
    renderRow(findTask('docs'), 'waiting', 1);
    fireEvent.click(screen.getByRole('button', { name: 'Waits on' }));
    expect(await screen.findByText('Starts when this finishes')).toBeTruthy();
    expect(location.pathname).toBe('/');
    expect(screen.getByRole('menuitem', { name: /Build the search index/ })).toBeTruthy();
  });

  it('is only on a nested row', () => {
    const view = renderRow(findTask('docs'), 'waiting', 0);
    expect(screen.queryByRole('button', { name: 'Waits on' })).toBeNull();
    view.unmount();
    renderRow(findTask('docs'), 'waiting', 1);
    expect(screen.getByRole('button', { name: 'Waits on' })).toBeTruthy();
  });

  it('opens a parent from the Waits on menu without opening the nested task', async () => {
    renderRow(findTask('docs'), 'waiting', 1);
    fireEvent.click(screen.getByRole('button', { name: 'Waits on' }));
    expect(await screen.findByText('Starts when this finishes')).toBeTruthy();
    expect(location.pathname).toBe('/');
    fireEvent.click(screen.getByRole('menuitem', { name: /Build the search index/ }));
    await waitFor(() => expect(location.pathname).toBe('/tasks/base'));
  });

  it('keeps the task closed when Enter lands on the arrow', () => {
    renderRow(findTask('docs'), 'waiting', 1);
    const arrow = screen.getByRole('button', { name: 'Waits on' });
    act(() => arrow.focus());
    fireEvent.keyDown(arrow, { key: 'Enter' });
    expect(location.pathname).toBe('/');
  });
});

describe('the repository column', () => {
  it('says No repository for a task that works without one', () => {
    renderRow(
      createTask({ id: 'research', title: 'Compare the search engines', stage: 'researching' }),
      'working'
    );
    expect(screen.getByText('No repository')).toBeTruthy();
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
    renderRow(task, 'working');
    expect(await findTooltipText(screen.getByRole('img', { name: 'Investigation' }))).toBe(
      'Investigation: find the repository, then investigate.'
    );
  });
});
