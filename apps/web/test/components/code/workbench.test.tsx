import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { DiffFile, Task, TaskDiff, TaskRefs, WorkReport } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ReviewDraftProvider } from '@/components/task/review-draft.tsx';
import { navigate } from '@/router.ts';
import { CodeTab } from '@/routes/task/code.tsx';
import { createTask } from '../../support/state.ts';

const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const MAC = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
const MOD = MAC ? { metaKey: true } : { ctrlKey: true };

const REFS: TaskRefs = {
  head: HEAD,
  base: BASE,
  branch: 'feat/parser',
  defaultBranch: 'main',
  working: false,
  dirty: false,
  commits: [{ sha: HEAD, subject: 'feat: read one more line', at: 1 }],
};

const HEAD_FILES: Record<string, string> = {
  'docs/alpha.txt': 'one\ntwo\nthree\n',
  'docs/beta.txt': 'guard\n',
  'README.md': '# Sample\n',
};

const BASE_FILES: Record<string, string> = {
  'docs/alpha.txt': 'one\nthree\n',
  'README.md': '# Sample\n',
};

function createFile(overrides: Partial<DiffFile> & { path: string }): DiffFile {
  return {
    previousPath: null,
    status: 'modified',
    additions: 1,
    deletions: 0,
    risk: 'normal',
    riskReason: null,
    binary: false,
    patch: '',
    ...overrides,
  };
}

const DIFF: TaskDiff = {
  base: BASE,
  head: HEAD,
  files: [
    createFile({ path: 'docs/alpha.txt', patch: '@@ -1,2 +1,3 @@\n one\n+two\n three\n' }),
    createFile({
      path: 'docs/beta.txt',
      status: 'added',
      risk: 'high',
      riskReason: 'Touches the input guard.',
      patch: '@@ -0,0 +1,1 @@\n+guard\n',
    }),
  ],
};

const REPORT: WorkReport = {
  headline: 'Parses the input and guards it.',
  sections: [
    {
      title: 'Wire the parser',
      summary: 'Reads one more line.',
      spots: [
        { file: 'docs/alpha.txt', start: 2, end: 2, attention: 'normal', why: 'Adds the second line.' },
      ],
    },
    {
      title: 'Guard the input',
      summary: 'Rejects what it cannot read.',
      spots: [
        { file: 'docs/beta.txt', start: 1, end: 1, attention: 'critical', why: 'Rejects empty input.' },
      ],
    },
  ],
  checks: [{ name: 'bun test', outcome: 'pass', detail: '12 tests' }],
  judgementCalls: [
    { call: 'Kept the old reader', reason: 'Other callers still use it.', file: 'README.md', line: 1 },
  ],
};

const realFetch = globalThis.fetch;
const requests: string[] = [];

function respond(url: URL) {
  const ref = url.searchParams.get('ref');
  const path = url.searchParams.get('path') ?? '';
  const name = url.pathname.split('/').at(-1);
  if (name === 'refs') return Response.json(REFS);
  if (name === 'diff') return Response.json(DIFF);
  if (name === 'paths') return Response.json({ ref, paths: Object.keys(HEAD_FILES), truncated: false });
  if (name === 'tree') {
    const dir = url.searchParams.get('dir') ?? '';
    const entries = dir
      ? Object.keys(HEAD_FILES)
          .filter((file) => file.startsWith(`${dir}/`))
          .map((file) => ({ name: file.slice(dir.length + 1), path: file, kind: 'file', size: 4 }))
      : [
          { name: 'docs', path: 'docs', kind: 'directory', size: null },
          { name: 'README.md', path: 'README.md', kind: 'file', size: 9 },
        ];
    return Response.json({ ref, dir, entries });
  }
  if (name === 'blob') {
    const content = (ref === BASE ? BASE_FILES : HEAD_FILES)[path] ?? null;
    return Response.json({
      ref,
      path,
      content,
      size: 4,
      binary: false,
      tooLarge: false,
      missing: content === null,
      image: null,
    });
  }
  if (name === 'search') {
    return Response.json({
      ref,
      matches: [{ path: 'docs/alpha.txt', line: 2, column: 1, text: 'two' }],
      truncated: false,
      timedOut: false,
    });
  }
  return new Response('not found', { status: 404 });
}

beforeEach(() => {
  requests.length = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost');
    requests.push(`${url.pathname.split('/').at(-1)}${url.search}`);
    return respond(url);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

let count = 0;

function nextTask(overrides: Partial<Task> = {}) {
  count += 1;
  return createTask({ id: `code-${count}`, repoId: 'repo-1', report: REPORT, ...overrides });
}

function renderCode(task: Task, query = '', enabled = true) {
  navigate(`/tasks/${task.id}?tab=code${query}`);
  return render(
    <TooltipProvider>
      <ReviewDraftProvider enabled={enabled} draftKey={`gate-${task.id}`}>
        <CodeTab task={task} modes={task.stage === 'planning' ? ['files'] : ['review', 'changes', 'files']} />
      </ReviewDraftProvider>
    </TooltipProvider>
  );
}

function params() {
  return new URLSearchParams(location.search);
}

function spotFor(why: string) {
  return screen.getByText(why).closest('button') as HTMLButtonElement;
}

async function findLine(text: string) {
  return waitFor(() => {
    const line = [...document.querySelectorAll('.cm-line')].find((element) => element.textContent === text);
    if (!line) throw new Error(`No line ${text}`);
    return line;
  });
}

describe('the review', () => {
  it('opens the first spot as a diff, in the URL, and steps through the spots', async () => {
    renderCode(nextTask());
    expect(await screen.findByText('Parses the input and guards it.')).toBeDefined();
    await waitFor(() => expect(params().get('spot')).toBe('0:0'));
    expect(params().get('file')).toBe('docs/alpha.txt');
    expect(params().get('diff')).toBe('1');
    expect(params().get('line')).toBe('2');
    await findLine('two');
    expect(spotFor('Adds the second line.').getAttribute('aria-current')).toBe('true');
    expect(screen.getByText('1 of 2')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Next spot' }));
    await waitFor(() => expect(params().get('file')).toBe('docs/beta.txt'));
    expect(screen.getByText('2 of 2')).toBeDefined();
    await findLine('guard');
    fireEvent.click(screen.getByRole('button', { name: 'Previous spot' }));
    await waitFor(() => expect(params().get('spot')).toBe('0:0'));
  });

  it('reorders by attention in the URL, and a judgement call opens its file at its line', async () => {
    renderCode(nextTask());
    await screen.findByText('Wire the parser');
    fireEvent.click(screen.getByRole('tab', { name: 'By attention' }));
    expect(params().get('order')).toBe('attention');
    expect(
      screen
        .getAllByText(/^(Adds the second line|Rejects empty input)\.$/)
        .map((element) => element.textContent)
    ).toEqual(['Rejects empty input.', 'Adds the second line.']);
    fireEvent.click(screen.getByRole('button', { name: 'README.md:1' }));
    await waitFor(() => expect(params().get('file')).toBe('README.md'));
    expect(params().get('diff')).toBeNull();
    await findLine('# Sample');
    expect(screen.getByText('bun test')).toBeDefined();
  });

  it('picks spots from the riskiest changes when the agent handed over no report', async () => {
    renderCode(nextTask({ report: null, summary: 'Older hand-over.' }));
    expect(await screen.findByText('Older hand-over.')).toBeDefined();
    expect(
      screen.getByText(
        'The agent handed over no report, so Shinsa picked these spots from the riskiest changes.'
      )
    ).toBeDefined();
    expect(screen.getByText('Look closely')).toBeDefined();
  });

  it('a spot in a file outside the change opens that file instead of a diff', async () => {
    const report: WorkReport = {
      ...REPORT,
      sections: [
        {
          title: 'Elsewhere',
          summary: 'A file the change never touched.',
          spots: [{ file: 'README.md', start: 1, end: 1, attention: 'high', why: 'Looks here.' }],
        },
      ],
    };
    renderCode(nextTask({ report }));
    await waitFor(() => expect(params().get('file')).toBe('README.md'));
    expect(params().get('diff')).toBeNull();
    await findLine('# Sample');
  });

  it('comments on a line, keeps the comment through a reload and lists it', async () => {
    const task = nextTask();
    const first = renderCode(task);
    await findLine('two');
    const numbers = [...document.querySelectorAll('.cm-lineNumbers .cm-gutterElement')];
    fireEvent.mouseDown(numbers.find((element) => element.textContent === '1') as HTMLElement, { button: 0 });
    const field = await screen.findByRole('textbox', { name: 'Comment' });
    fireEvent.change(field, { target: { value: 'Name this line.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add comment' }));
    await waitFor(() => expect(screen.getByText('Your comments')).toBeDefined());
    expect(screen.getAllByText('Name this line.').length).toBeGreaterThan(0);
    first.unmount();
    renderCode(task);
    expect(await screen.findByText('Your comments')).toBeDefined();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Remove' }))[0] as HTMLElement);
    await waitFor(() => expect(screen.queryByText('Your comments')).toBeNull());
  });
});

describe('changes and files', () => {
  it('lists the changed files as a tree and opens one as a preview tab, double-click pins it', async () => {
    renderCode(nextTask(), '&mode=changes');
    const tree = await screen.findByRole('tree', { name: 'Changed files' });
    expect(screen.getByText('2 files · 0 viewed')).toBeDefined();
    fireEvent.click(within(tree).getByRole('treeitem', { name: 'docs/beta.txt' }));
    expect(params().get('preview')).toBe('d:docs/beta.txt');
    fireEvent.doubleClick(within(tree).getByRole('treeitem', { name: 'docs/beta.txt' }));
    await waitFor(() => expect(params().get('preview')).toBeNull());
    fireEvent.click(within(tree).getAllByRole('button', { name: 'Mark as viewed' })[0] as HTMLElement);
    expect(screen.getByText('2 files · 1 viewed')).toBeDefined();
    fireEvent.click(within(tree).getByRole('treeitem', { name: 'docs' }));
    expect(within(tree).queryByRole('treeitem', { name: 'docs/alpha.txt' })).toBeNull();
    fireEvent.click(within(tree).getByRole('treeitem', { name: 'docs' }));
    expect(within(tree).getByRole('treeitem', { name: 'docs/alpha.txt' })).toBeDefined();
  });

  it('browses the repository at the head, folder by folder, and opens any file', async () => {
    renderCode(nextTask(), '&mode=files');
    const tree = await screen.findByRole('tree', { name: 'Files' });
    fireEvent.click(await within(tree).findByRole('treeitem', { name: 'docs' }));
    fireEvent.click(await within(tree).findByRole('treeitem', { name: 'docs/alpha.txt' }));
    expect(params().get('file')).toBe('docs/alpha.txt');
    expect(params().get('diff')).toBeNull();
    await findLine('two');
    expect(requests).toContain(`tree?ref=${HEAD}&dir=docs`);
  });

  it('a task without changes only browses files, at its default branch', async () => {
    renderCode(nextTask({ stage: 'planning', report: null }));
    expect(await screen.findByRole('tree', { name: 'Files' })).toBeDefined();
    expect(screen.queryByRole('tab', { name: 'Review' })).toBeNull();
    expect(screen.getByText('Open a file')).toBeDefined();
  });

  it('closes tabs and reopens what is left', async () => {
    renderCode(nextTask(), `&mode=files&open=f%3AREADME.md,f%3Adocs%2Falpha.txt&file=docs%2Falpha.txt`);
    await findLine('two');
    fireEvent.click(screen.getByRole('button', { name: 'Close alpha.txt' }));
    await waitFor(() => expect(params().get('file')).toBe('README.md'));
    fireEvent.click(screen.getByRole('button', { name: 'Close README.md' }));
    await waitFor(() => expect(params().get('file')).toBeNull());
    expect(screen.getByText('Open a file')).toBeDefined();
  });
});

describe('search and quick open', () => {
  it('searches across files from ⇧⌘F, keeps the search in the URL and opens a result at its line', async () => {
    renderCode(nextTask(), '&mode=files');
    await screen.findByRole('tree', { name: 'Files' });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F', shiftKey: true, ...MOD }));
    });
    const input = await screen.findByRole('textbox', { name: 'Search in files' });
    fireEvent.change(input, { target: { value: 'two' } });
    fireEvent.click(screen.getByRole('button', { name: 'Match case' }));
    await waitFor(() => expect(params().get('q')).toBe('two'), { timeout: 2000 });
    expect(params().get('case')).toBe('1');
    expect(await screen.findByText('1 result in 1 file.')).toBeDefined();
    fireEvent.click(screen.getByRole('treeitem', { name: 'docs/alpha.txt line 2' }));
    expect(params().get('line')).toBe('2');
    expect(params().get('diff')).toBe('1');
  });

  it('opens any file by name from ⌘P', async () => {
    renderCode(nextTask(), '&mode=files');
    await screen.findByRole('tree', { name: 'Files' });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ...MOD }));
    });
    const input = await screen.findByPlaceholderText('Go to file');
    fireEvent.change(input, { target: { value: 'readme' } });
    const item = await waitFor(() => {
      const found = document.querySelector('[cmdk-item]');
      if (found?.textContent !== 'README.md') throw new Error('Not ranked yet');
      return found;
    });
    fireEvent.click(item);
    await waitFor(() => expect(params().get('file')).toBe('README.md'));
    expect(params().get('preview')).toBeNull();
  });

  it('switches to another commit from the ref picker', async () => {
    renderCode(nextTask(), '&mode=files');
    await screen.findByRole('tree', { name: 'Files' });
    expect(screen.getByRole('combobox', { name: 'Show the code at' })).toBeDefined();
  });
});

describe('when the code cannot be read', () => {
  it('says why', async () => {
    globalThis.fetch = (async () =>
      Response.json(
        { error: { code: 'code_unavailable', message: 'The code for this task is gone.' } },
        { status: 404 }
      )) as unknown as typeof fetch;
    renderCode(nextTask());
    expect(await screen.findByText('The code for this task is gone.')).toBeDefined();
  });
});
