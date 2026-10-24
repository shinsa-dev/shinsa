import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { ShinsaState } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, render } from '@testing-library/react';
import { InlineMarkdown, Markdown } from '@/components/text/markdown.tsx';
import { replaceRoute } from '@/router.ts';
import { pushState, startFakeServer, stopFakeServer } from '../../support/server.ts';
import { createShinsaState, createTask } from '../../support/state.ts';

const realFetch = globalThis.fetch;

let revision = 1_000;

function createWorld(branch: string | null = 'feat/login') {
  revision += 1;
  return createShinsaState({
    tasks: [
      createTask({ id: 'task-1', title: 'Fix the flaky checkout test', branch, updatedAt: revision }),
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

function serveDiff(paths: string[]) {
  const fetchMock = mock(async (_url: string) =>
    Response.json({ files: paths.map((path) => ({ path, additions: 1, deletions: 0 })) })
  );
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

async function settle() {
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
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
  it('links a file in the task diff to Code → All files', async () => {
    const fetchMock = serveDiff(['src/login.ts']);
    const state = createWorld();
    openTaskPage('task-1');
    const view = renderMarkdown(state, 'Changed [src/login.ts](shinsa://file/src/login.ts#L3-L5).');
    await settle();
    const link = view.getByRole('link');
    expect(link.getAttribute('href')).toBe('/tasks/task-1?tab=code&view=changes&file=src%2Flogin.ts');
    expect(link.textContent).toBe('src/login.ts');
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`/api/tasks/task-1/diff?r=${revision}`);
  });

  it('keeps a file outside the diff as plain code', async () => {
    serveDiff(['src/other.ts']);
    const state = createWorld();
    openTaskPage('task-1');
    const view = renderMarkdown(state, 'Read [src/login.ts](shinsa://file/src/login.ts).');
    await settle();
    expect(view.queryByRole('link')).toBeNull();
    expect(view.getByText('src/login.ts').tagName).toBe('CODE');
  });

  it('keeps a file as plain code while the diff cannot be read', async () => {
    globalThis.fetch = mock(async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
    const state = createWorld();
    openTaskPage('task-1');
    const view = renderMarkdown(state, 'Read [src/login.ts](shinsa://file/src/login.ts).');
    await settle();
    expect(view.queryByRole('link')).toBeNull();
    expect(view.getByText('src/login.ts').tagName).toBe('CODE');
  });

  it('keeps a file as plain code outside a task page', () => {
    const fetchMock = serveDiff(['src/login.ts']);
    const view = renderMarkdown(createWorld(), 'Read [src/login.ts](shinsa://file/src/login.ts).');
    expect(view.queryByRole('link')).toBeNull();
    expect(view.getByText('src/login.ts').tagName).toBe('CODE');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps a file as plain code when the task has no branch yet', () => {
    const fetchMock = serveDiff(['src/login.ts']);
    const state = createWorld(null);
    openTaskPage('task-1');
    const view = renderMarkdown(state, 'Read [src/login.ts](shinsa://file/src/login.ts).');
    expect(view.queryByRole('link')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
