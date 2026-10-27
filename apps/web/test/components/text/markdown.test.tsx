import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { ShinsaState, TaskStage } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, render } from '@testing-library/react';
import { InlineMarkdown, Markdown } from '@/components/text/markdown.tsx';
import { replaceRoute } from '@/router.ts';
import { pushState, startFakeServer, stopFakeServer } from '../../support/server.ts';
import { createShinsaState, createTask } from '../../support/state.ts';

const realFetch = globalThis.fetch;

let revision = 1_000;

function createWorld(branch: string | null = 'feat/login', stage: TaskStage = 'building') {
  revision += 1;
  return createShinsaState({
    tasks: [
      createTask({
        id: 'task-1',
        title: 'Fix the flaky checkout test',
        branch,
        stage,
        mode: stage === 'answering' ? 'ask' : 'build',
        repoId: branch ? 'repo-1' : null,
        updatedAt: revision,
      }),
      createTask({ id: 'task-2', title: 'Build the login form' }),
    ],
  });
}

function renderMarkdown(state: ShinsaState, text: string, inline = false) {
  pushState(state);
  return render(
    <TooltipProvider>{inline ? <InlineMarkdown text={text} /> : <Markdown text={text} />}</TooltipProvider>
  );
}

function openTaskPage(taskId: string) {
  act(() => {
    replaceRoute(`/tasks/${taskId}`);
  });
}

beforeEach(() => {
  startFakeServer();
});

afterEach(() => {
  stopFakeServer();
  globalThis.fetch = realFetch;
});

describe('Markdown references', () => {
  it('renders a task link under the task title', () => {
    const view = renderMarkdown(createWorld(), 'Depends on [the form](shinsa://task/task-2).');
    const link = view.getByRole('link');
    expect(link.textContent).toBe('Build the login form');
    expect(link.hasAttribute('data-smart')).toBe(true);
  });

  it('keeps the label of a link to an unknown task as plain text', () => {
    const view = renderMarkdown(createWorld(), 'Depends on [the old task](shinsa://task/gone).');
    expect(view.queryByRole('link')).toBeNull();
    expect(view.container.textContent).toBe('Depends on the old task.');
  });

  it('keeps the label of a malformed reference as plain text', () => {
    const view = renderMarkdown(createWorld(), 'See [this file](shinsa://file/../secret).');
    expect(view.queryByRole('link')).toBeNull();
    expect(view.container.textContent).toBe('See this file.');
  });

  it('links another task by its exact title', () => {
    const view = renderMarkdown(createWorld(), 'Build the login form before this.');
    expect(view.getByRole('link').textContent).toBe('Build the login form');
  });

  it('does not link the current task to itself on its own page', () => {
    openTaskPage('task-2');
    const view = renderMarkdown(createWorld(), 'Build the login form, then Fix the flaky checkout test.');
    const links = view.getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(['Fix the flaky checkout test']);
  });

  it('opens an ordinary link in a new tab', () => {
    const view = renderMarkdown(createWorld(), 'Read [the docs](https://example.com/docs).');
    const link = view.getByRole('link');
    expect(link.getAttribute('href')).toBe('https://example.com/docs');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.hasAttribute('data-smart')).toBe(false);
  });
});

describe('InlineMarkdown references', () => {
  it('shows a task reference as plain text under the task title', () => {
    const view = renderMarkdown(createWorld(), 'Waits on [the form](shinsa://task/task-2)', true);
    expect(view.queryByRole('link')).toBeNull();
    expect(view.container.textContent).toBe('Waits on Build the login form');
  });

  it('shows an unknown reference by its label', () => {
    const view = renderMarkdown(createWorld(), 'Waits on [the old task](shinsa://task/gone)', true);
    expect(view.queryByRole('link')).toBeNull();
    expect(view.container.textContent).toBe('Waits on the old task');
  });

  it('shows the label of a malformed reference', () => {
    const view = renderMarkdown(createWorld(), 'Waits on [nothing](shinsa://nothing/here)', true);
    expect(view.queryByRole('link')).toBeNull();
    expect(view.container.textContent).toBe('Waits on nothing');
  });
});

describe('FileLink', () => {
  it('links a file of a task with changes to its diff in Code, at its lines', () => {
    const state = createWorld();
    openTaskPage('task-1');
    const view = renderMarkdown(state, 'Changed [src/login.ts](shinsa://file/src/login.ts#L3-L5).');
    const link = view.getByRole('link');
    expect(link.getAttribute('href')).toBe(
      '/tasks/task-1?tab=code&mode=changes&file=src%2Flogin.ts&diff=1&line=3&end=5'
    );
    expect(link.textContent).toBe('src/login.ts');
  });

  it('links a file of a task that changes nothing to the file itself', () => {
    const state = createWorld('feat/login', 'answering');
    openTaskPage('task-1');
    const view = renderMarkdown(state, 'Read [src/login.ts](shinsa://file/src/login.ts).');
    expect(view.getByRole('link').getAttribute('href')).toBe(
      '/tasks/task-1?tab=code&mode=files&file=src%2Flogin.ts'
    );
  });

  it('keeps a file as plain code outside a task page', () => {
    const view = renderMarkdown(createWorld(), 'Read [src/login.ts](shinsa://file/src/login.ts).');
    expect(view.queryByRole('link')).toBeNull();
    expect(view.getByText('src/login.ts').tagName).toBe('CODE');
  });

  it('keeps a file as plain code when the task has no repository yet', () => {
    const state = createWorld(null);
    openTaskPage('task-1');
    const view = renderMarkdown(state, 'Read [src/login.ts](shinsa://file/src/login.ts).');
    expect(view.queryByRole('link')).toBeNull();
  });
});

describe('Markdown task lists', () => {
  it('draws a task list as read-only checklist rows, nested content kept', () => {
    const text =
      '- [x] Update the changelog\n- [ ] Check the notes\n  - read the migration\n\n1. one\n2. two';
    const view = renderMarkdown(createWorld(), text);
    expect(view.queryByRole('checkbox')).toBeNull();
    const rows = view.container.querySelectorAll('[data-slot=checklist-item]');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent?.trim()).toBe('Update the changelog');
    expect(rows[0]?.querySelector('[data-slot=checklist-mark]')?.getAttribute('aria-label')).toBe('Done');
    expect(rows[1]?.querySelector('[data-slot=checklist-mark]')?.getAttribute('aria-label')).toBe('Not done');
    expect(rows[1]?.querySelector('ul li')?.textContent).toBe('read the migration');
    expect(view.container.querySelectorAll('ol li')).toHaveLength(2);
  });

  it('reads a loose task list and a numbered one the same way', () => {
    const view = renderMarkdown(createWorld(), '3. [x] First\n\n4. [ ] Second\n\n   More about it.');
    const rows = view.container.querySelectorAll('[data-slot=checklist-item]');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.querySelector('[data-slot=checklist-mark]')?.getAttribute('aria-label')).toBe('Done');
    expect(rows[1]?.textContent).toContain('More about it.');
    expect(view.container.querySelector('input')).toBeNull();
  });

  it('keeps a numbered list starting where it says', () => {
    const view = renderMarkdown(createWorld(), '3. three\n4. four');
    expect(view.container.querySelector('ol')?.getAttribute('start')).toBe('3');
  });
});
