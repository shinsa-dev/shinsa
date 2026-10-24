import { describe, expect, it } from 'bun:test';
import type { ShinsaState, Task } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { TasksPage } from '@/routes/tasks.tsx';
import { createGate, createShinsaState, createTask } from '../support/state.ts';

const ROADMAP = createShinsaState({
  tasks: [
    createTask({ id: 'merge', title: 'Land the billing change', stage: 'awaiting_merge' }),
    createTask({ id: 'review', title: 'Review the login fix', stage: 'reviewing' }),
    createTask({ id: 'plan', title: 'Plan the export', stage: 'planning' }),
    createTask({ id: 'answer', title: 'Pick a chart library', stage: 'building' }),
    createTask({ id: 'paused', title: 'Retry the flaky upload', stage: 'building' }),
    createTask({
      id: 'working',
      title: 'Build the search index',
      stage: 'building',
      branch: 'feat/search-index',
    }),
    createTask({ id: 'waiting', title: 'Ship search docs', stage: 'waiting_on_tasks', waitsOn: ['working'] }),
    createTask({ id: 'done', title: 'Rename the settings page', stage: 'merged' }),
    createTask({
      id: 'cancelled',
      title: 'Try a new font',
      stage: 'cancelled',
      request: 'Swap Inter for Geist',
    }),
  ],
  gates: [
    createGate({ id: 'g-merge', taskId: 'merge', type: 'merge' }),
    createGate({ id: 'g-review', taskId: 'review', type: 'review' }),
    createGate({ id: 'g-plan', taskId: 'plan', type: 'plan' }),
    createGate({ id: 'g-answer', taskId: 'answer', type: 'question' }),
    createGate({ id: 'g-paused', taskId: 'paused', type: 'failure' }),
  ],
});

function visit(path: string) {
  history.replaceState(null, '', path);
  dispatchEvent(new PopStateEvent('popstate'));
}

function renderPage(state: ShinsaState = ROADMAP, path = '/tasks') {
  visit(path);
  return render(
    <TooltipProvider>
      <TasksPage state={state} />
    </TooltipProvider>
  );
}

function groupHeaders() {
  return screen
    .queryAllByRole('button')
    .filter((button) => button.hasAttribute('aria-expanded'))
    .map((button) => `${button.textContent}|${button.getAttribute('aria-expanded')}`);
}

function rows() {
  return screen.queryAllByRole('button').filter((button) => button.tagName === 'DIV');
}

function rowFor(title: string) {
  const row = rows().find((candidate) => candidate.textContent?.includes(title));
  if (!row) throw new Error(`No row for ${title}`);
  return row;
}

function rowTitles(titles: string[]) {
  return rows().map((row) => titles.find((title) => row.textContent?.startsWith(title) ?? false));
}

describe('the roadmap groups', () => {
  it('lists every group in order with its count, Done and Cancelled collapsed', () => {
    renderPage();
    expect(groupHeaders()).toEqual([
      'Ready to merge1|true',
      'Changes to review1|true',
      'Plan to approve1|true',
      'Needs your answer1|true',
      'Paused1|true',
      'In progress1|true',
      'Waiting on another task1|true',
      'Done1|false',
      'Cancelled1|false',
    ]);
    expect(screen.queryByText('Rename the settings page')).toBeNull();
    expect(screen.getByText('7 open · 1 done')).toBeTruthy();
  });

  it('opens a collapsed group from its header', () => {
    renderPage();
    act(() => fireEvent.click(screen.getByRole('button', { name: /^Done/ })));
    expect(screen.getByText('Rename the settings page')).toBeTruthy();
    act(() => fireEvent.click(screen.getByRole('button', { name: /^Done/ })));
    expect(screen.queryByText('Rename the settings page')).toBeNull();
  });

  it('opens a task from its row', () => {
    renderPage();
    act(() => fireEvent.click(rowFor('Review the login fix')));
    expect(location.pathname).toBe('/tasks/review');
  });

  it('opens a focused row on Enter', () => {
    renderPage();
    const row = rowFor('Plan the export');
    row.focus();
    act(() => fireEvent.keyDown(row, { key: 'Enter' }));
    expect(location.pathname).toBe('/tasks/plan');
  });

  it('ignores other keys on a focused row', () => {
    renderPage();
    act(() => fireEvent.keyDown(rowFor('Plan the export'), { key: ' ' }));
    expect(location.pathname).toBe('/tasks');
  });
});

describe('filtering', () => {
  it('shows only the status in the URL, opened, with a button that clears it', () => {
    renderPage(ROADMAP, '/tasks?status=done');
    expect(groupHeaders()).toEqual(['Done1|true']);
    expect(screen.getByText('Rename the settings page')).toBeTruthy();
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Done' })));
    expect(location.search).toBe('');
    expect(groupHeaders()).toHaveLength(9);
  });

  it('ignores a status it does not know', () => {
    renderPage(ROADMAP, '/tasks?status=someday');
    expect(groupHeaders()).toHaveLength(9);
  });

  it.each([
    ['the title', 'Login Fix', 'Changes to review1|true'],
    ['the intent', 'geist', 'Cancelled1|false'],
    ['the branch', 'feat/search', 'In progress1|true'],
  ])('searches %s', (_, query, group) => {
    renderPage(ROADMAP, `/tasks?q=${encodeURIComponent(query)}`);
    expect(groupHeaders()).toEqual([group]);
    expect((screen.getByRole('searchbox', { name: 'Search tasks' }) as HTMLInputElement).value).toBe(query);
  });

  it('writes the search into the URL as it is typed', () => {
    renderPage();
    act(() =>
      fireEvent.change(screen.getByRole('searchbox', { name: 'Search tasks' }), {
        target: { value: 'export' },
      })
    );
    expect(location.search).toBe('?q=export');
    expect(groupHeaders()).toEqual(['Plan to approve1|true']);
    act(() =>
      fireEvent.change(screen.getByRole('searchbox', { name: 'Search tasks' }), { target: { value: '' } })
    );
    expect(location.search).toBe('');
  });

  it('says nothing matches a search without results', () => {
    renderPage(ROADMAP, '/tasks?q=nothing-like-this');
    expect(screen.getByText('Nothing matches')).toBeTruthy();
    expect(
      screen.getByText('Try another word from the title, branch or repository, or clear the filter.')
    ).toBeTruthy();
  });

  it('says there are no tasks yet on an empty roadmap', () => {
    renderPage(createShinsaState({}));
    expect(screen.getByText('No tasks yet')).toBeTruthy();
    expect(
      screen.getByText('Describe the work on Home. Shinsa finds the repository and starts the agents.')
    ).toBeTruthy();
  });
});

function chain(tasks: Task[]) {
  return createShinsaState({
    tasks: [createTask({ id: 'root', title: 'Root work', stage: 'building' }), ...tasks],
  });
}

function waiting(id: string, title: string, waitsOn: string[], overrides: Partial<Task> = {}) {
  return createTask({ id, title, stage: 'waiting_on_tasks', waitsOn, ...overrides });
}

function waitingRows() {
  const header = screen.getByRole('button', { name: /^Waiting on another task/ });
  const section = header.closest('section') as HTMLElement;
  return within(section)
    .queryAllByRole('button')
    .filter((button) => button.tagName === 'DIV');
}

function depthOf(row: HTMLElement) {
  return Number(row.dataset.depth);
}

describe('Waiting on another task as chains', () => {
  it('nests a straight chain by depth', () => {
    renderPage(
      chain([waiting('a', 'Step A', ['root']), waiting('b', 'Step B', ['a']), waiting('c', 'Step C', ['b'])])
    );
    const shown = waitingRows();
    expect(shown.map((row) => row.textContent?.slice(0, 6))).toEqual(['Step A', 'Step B', 'Step C']);
    expect(shown.map(depthOf)).toEqual([0, 1, 2]);
  });

  it('caps the indent of a very deep chain', () => {
    renderPage(
      chain([
        waiting('a', 'Step A', ['root']),
        waiting('b', 'Step B', ['a']),
        waiting('c', 'Step C', ['b']),
        waiting('d', 'Step D', ['c']),
        waiting('e', 'Step E', ['d']),
      ])
    );
    expect(waitingRows().map(depthOf)).toEqual([0, 1, 2, 3, 3]);
  });

  it('puts fan-out siblings side by side under their parent', () => {
    renderPage(
      chain([
        waiting('parent', 'Parent step', ['root']),
        waiting('left', 'Left branch', ['parent'], { priority: 'high' }),
        waiting('right', 'Right branch', ['parent']),
      ])
    );
    const shown = waitingRows();
    expect(rowTitles(['Parent step', 'Left branch', 'Right branch']).filter(Boolean)).toEqual([
      'Parent step',
      'Left branch',
      'Right branch',
    ]);
    expect(shown.map(depthOf)).toEqual([0, 1, 1]);
  });

  it('shows the joining task of a diamond once, after both parents, two levels in', () => {
    renderPage(
      chain([
        waiting('a', 'Step A', ['root']),
        waiting('b', 'Step B', ['a']),
        waiting('c', 'Step C', ['a']),
        waiting('d', 'Step D', ['b', 'c']),
      ])
    );
    const shown = waitingRows();
    expect(shown.map((row) => row.textContent?.slice(0, 6))).toEqual([
      'Step A',
      'Step B',
      'Step C',
      'Step D',
    ]);
    expect(shown.map(depthOf)).toEqual([0, 1, 1, 2]);
  });

  it('names every parent in the status column, each a link that opens it', () => {
    renderPage(
      chain([
        waiting('a', 'Step A', ['root']),
        waiting('b', 'Step B', ['a']),
        waiting('c', 'Step C', ['a']),
        waiting('d', 'Step D', ['b', 'c']),
      ])
    );
    const joined = rowFor('Step D');
    expect(joined.textContent).toContain('Waits on Step B, Step C');
    const links = within(joined).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/tasks/b', '/tasks/c']);
    act(() => fireEvent.click(within(joined).getByRole('link', { name: 'Step C' })));
    expect(location.pathname).toBe('/tasks/c');
  });

  it('says when a parent was cancelled', () => {
    renderPage(
      createShinsaState({
        tasks: [
          createTask({ id: 'gone', title: 'Old migration', stage: 'cancelled' }),
          createTask({ id: 'live', title: 'Live migration', stage: 'building' }),
          waiting('next', 'Backfill users', ['live', 'gone']),
        ],
      })
    );
    const row = rowFor('Backfill users');
    expect(row.textContent).toContain('Old migration was cancelled');
    expect(row.textContent).not.toContain('Waits on');
    expect(within(row).getByRole('link', { name: 'Old migration' }).getAttribute('href')).toBe('/tasks/gone');
  });
});
