import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { DiffFile, Task, TaskDiff } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ChangesPane } from '@/components/code/changes.tsx';
import { ReviewDraftProvider } from '@/components/task/review-draft.tsx';
import { updateSearchParams } from '@/router.ts';
import { createTask } from '../../support/state.ts';

const realFetch = globalThis.fetch;

const CONTENT: Record<string, string> = {
  'docs/alpha.txt': 'alpha first\nalpha second\n',
  'docs/beta.txt': 'beta guard\n',
  'readme.txt': 'readme intro\n',
};

function createFile(overrides: Partial<DiffFile> & { path: string }): DiffFile {
  return {
    previousPath: null,
    status: 'modified',
    additions: 1,
    deletions: 0,
    risk: 'normal',
    riskReason: null,
    patch: '',
    ...overrides,
  };
}

const DIFF: TaskDiff = {
  base: 'main',
  files: [
    createFile({
      path: 'readme.txt',
      additions: 2,
      deletions: 1,
      patch: '@@ -1,1 +1,1 @@\n-old intro\n+readme intro\n',
    }),
    createFile({
      path: 'docs/beta.txt',
      status: 'renamed',
      previousPath: 'docs/old-beta.txt',
      risk: 'high',
      riskReason: 'Touches the input guard.',
      patch: '@@ -1,1 +1,1 @@\n-beta\n+beta guard\n',
    }),
    createFile({
      path: 'docs/alpha.txt',
      additions: 3,
      patch: '@@ -1,1 +1,2 @@\n alpha first\n+alpha second\n',
    }),
  ],
};

let taskCount = 0;

function nextTask() {
  taskCount += 1;
  return createTask({ id: `changes-${taskCount}` });
}

beforeEach(() => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost');
    if (!url.pathname.endsWith('/file')) return new Response('not found', { status: 404 });
    return Response.json({ content: CONTENT[url.searchParams.get('path') ?? ''] ?? null });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function renderPane(task: Task) {
  return render(
    <TooltipProvider>
      <ReviewDraftProvider enabled draftKey={task.id}>
        <ChangesPane task={task} diff={DIFF} />
      </ReviewDraftProvider>
    </TooltipProvider>
  );
}

function fileRow(name: string) {
  const rows = screen.getAllByText(name).flatMap((element) => element.closest('button') ?? []);
  return rows[0] as HTMLButtonElement;
}

describe('the all-files view', () => {
  it('counts the files and lines, groups them by folder and opens the first file', async () => {
    renderPane(nextTask());
    expect(screen.getByText('3 files').textContent).toBe('3 files+6 −1');
    expect(screen.getByText('docs/')).toBeDefined();
    expect(await screen.findByText('readme intro')).toBeDefined();
    expect(screen.getByText('old intro')).toBeDefined();
    expect(screen.queryByText('alpha second')).toBeNull();
  });

  it('opens the file a person picks', async () => {
    renderPane(nextTask());
    expect(await screen.findByText('readme intro')).toBeDefined();
    fireEvent.click(fileRow('beta.txt'));
    expect(await screen.findByText('beta guard')).toBeDefined();
    expect(screen.queryByText('readme intro')).toBeNull();
    expect(screen.getByText('renamed from docs/old-beta.txt')).toBeDefined();
    expect(screen.getByText('Touches the input guard.')).toBeDefined();
  });

  it('opens the file the link names, and follows the link when it changes', async () => {
    updateSearchParams({ file: 'docs/alpha.txt' }, { replace: true });
    renderPane(nextTask());
    expect(await screen.findByText('alpha second')).toBeDefined();
    fireEvent.click(fileRow('readme.txt'));
    expect(await screen.findByText('readme intro')).toBeDefined();
    act(() => {
      updateSearchParams({ file: 'docs/beta.txt' });
    });
    expect(await screen.findByText('beta guard')).toBeDefined();
  });

  it('falls back to the first file when the link names a file outside the change', async () => {
    updateSearchParams({ file: 'docs/missing.txt' }, { replace: true });
    renderPane(nextTask());
    expect(await screen.findByText('readme intro')).toBeDefined();
  });

  it('counts a person’s comments on the file they belong to', async () => {
    renderPane(nextTask());
    fireEvent.click(await screen.findByRole('button', { name: 'Comment on line 1' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Comment' }), { target: { value: 'Rename this.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add comment' }));
    expect(screen.getByText('Rename this.')).toBeDefined();
    expect(fileRow('readme.txt').textContent).toBe('Mreadme.txt1+2 −1');
    expect(fileRow('alpha.txt').textContent).toBe('Malpha.txt+3 −0');
  });
});
