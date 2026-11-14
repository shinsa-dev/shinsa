import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { EditorView } from '@codemirror/view';
import type { DiffFile, Task, TaskDiff, TaskRefs, WorkReport } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ReviewDraftProvider } from '@/components/task/review-draft.tsx';
import { navigate } from '@/router.ts';
import { CodeTab } from '@/routes/task/code.tsx';
import { spyOnCommands } from '../../support/commands.ts';
import { findTooltipText } from '../../support/hover.ts';
import { pushState, startFakeServer, stopFakeServer } from '../../support/server.ts';
import { createShinsaState, createTask } from '../../support/state.ts';
import { waitForGone } from '../../support/wait.ts';

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
  checks: [{ id: 'c1', label: 'Tests', command: 'bun test', outcome: 'pass', detail: '12 tests' }],
  judgementCalls: [
    {
      title: 'Keep the old reader',
      call: 'Kept the old reader',
      reason: 'Other callers still use it.',
      file: 'README.md',
      line: 1,
    },
  ],
};

const realFetch = globalThis.fetch;
const requests: string[] = [];
const writes: unknown[] = [];

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
  if (name === 'file') return Response.json({ path: 'README.md', changed: true });
  if (name === 'open') return Response.json({ ok: true });
  if (name === 'search') {
    const found =
      url.searchParams.get('q') === 'nowhere'
        ? []
        : [{ path: 'docs/alpha.txt', line: 2, column: 1, text: 'two' }];
    const lines = [
      { kind: 'matches', matches: found },
      { kind: 'done', result: { ref, matches: [], truncated: false, timedOut: false } },
    ];
    return new Response(lines.map((line) => JSON.stringify(line)).join('\n'), {
      headers: { 'content-type': 'application/x-ndjson' },
    });
  }
  return new Response('not found', { status: 404 });
}

beforeEach(() => {
  requests.length = 0;
  writes.length = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    requests.push(`${url.pathname.split('/').at(-1)}${url.search}`);
    if (init?.body) writes.push(JSON.parse(String(init.body)));
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
        <CodeTab task={task} modes={task.stage === 'planning' ? ['files'] : ['changes', 'files']} />
      </ReviewDraftProvider>
    </TooltipProvider>
  );
}

function params() {
  return new URLSearchParams(location.search);
}

async function findLine(text: string) {
  return waitFor(() => {
    const line = [...document.querySelectorAll('.cm-line')].find((element) => element.textContent === text);
    if (!line) throw new Error(`No line ${text}`);
    return line;
  });
}

async function openFileOptions() {
  fireEvent.click(screen.getByRole('button', { name: 'File options' }));
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

describe('notes in the code', () => {
  it('opens the first changed file as a diff, and shows an agent finding as a rich note under its line', async () => {
    renderCode(
      nextTask({
        findings: [
          {
            severity: 'blocking',
            file: 'docs/alpha.txt',
            line: 2,
            message: 'The new line says `two`.',
            title: 'Wrong word',
            fix: 'Write `2` instead.',
          },
        ],
      })
    );
    await waitFor(() => expect(params().get('file')).toBe('docs/alpha.txt'));
    expect(params().get('diff')).toBe('1');
    await findLine('two');
    expect(await screen.findByText('Blocking')).toBeDefined();
    expect(document.body.textContent).toContain('The new line says two.');
    expect(screen.queryByText('Agent review')).toBeNull();
    expect(screen.getByText('Proposed fix')).toBeDefined();
  });

  it('names a spot in the app’s tooltip when its gutter mark is hovered', async () => {
    renderCode(nextTask(), '&mode=changes&file=docs%2Falpha.txt&diff=1');
    await findLine('two');
    const mark = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('.cm-spotMark [data-tooltip-trigger]');
      if (!found) throw new Error('No spot mark');
      return found;
    });
    expect(mark.parentElement?.hasAttribute('title')).toBe(false);
    expect(await findTooltipText(mark)).toBe('Context: Adds the second line.');
  });

  it('opens the file a link names at its line and washes the line, strongly at first', async () => {
    renderCode(nextTask(), '&mode=changes&file=docs%2Falpha.txt&diff=1&line=2');
    const line = await findLine('two');
    expect(params().get('file')).toBe('docs/alpha.txt');
    await waitFor(() => expect(line.className).toContain('cm-focus-flash'));
    expect(line.className).toContain('cm-focus-line');
  });

  it('comments on a line, keeps the comment through a reload and removes it', async () => {
    const task = nextTask();
    const first = renderCode(task);
    await findLine('two');
    const numbers = [...document.querySelectorAll('.cm-lineNumbers .cm-gutterElement')];
    fireEvent.mouseDown(numbers.find((element) => element.textContent === '1') as HTMLElement, { button: 0 });
    const field = await screen.findByRole('textbox', { name: 'Comment' });
    fireEvent.change(field, { target: { value: 'Name this line.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add comment' }));
    expect(await screen.findByText('Name this line.')).toBeDefined();
    expect(screen.getByText('You')).toBeDefined();
    first.unmount();
    renderCode(task);
    expect(await screen.findByText('Name this line.')).toBeDefined();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    await waitForGone(() => screen.queryByText('Name this line.'));
  });

  it('comments outside a review, edits the comment and sends it to the agent with its place', async () => {
    startFakeServer();
    const commands = spyOnCommands();
    const task = nextTask({ stage: 'building' });
    pushState(createShinsaState({ tasks: [task] }));
    navigate(`/tasks/${task.id}?tab=code`);
    render(
      <TooltipProvider>
        <ReviewDraftProvider enabled reviewing={false} withMessages draftKey={`task:${task.id}`}>
          <CodeTab task={task} modes={['changes', 'files']} />
        </ReviewDraftProvider>
      </TooltipProvider>
    );
    await findLine('two');
    const numbers = [...document.querySelectorAll('.cm-lineNumbers .cm-gutterElement')];
    fireEvent.mouseDown(numbers.find((element) => element.textContent === '2') as HTMLElement, { button: 0 });
    const field = await screen.findByRole('textbox', { name: 'Comment' });
    expect(field.getAttribute('placeholder')).toBe(
      'What should change here? It goes to the agent with your next message.'
    );
    fireEvent.change(field, { target: { value: 'Name this line.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add comment' }));
    expect(await screen.findByText('Name this line.')).toBeDefined();
    expect(screen.getByText('1 comment for the agent')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const editing = await screen.findByRole('textbox', { name: 'Comment' });
    expect((editing as HTMLTextAreaElement).value).toBe('Name this line.');
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    fireEvent.change(editing, { target: { value: 'Call it count.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save comment' }));
    expect(await screen.findByText('Call it count.')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Send to the agent' }));
    await waitForGone(() => screen.queryByText('Call it count.'));
    expect(commands.sent.mock.calls[0]?.[0]).toEqual({
      type: 'task.message',
      taskId: task.id,
      text: '',
      comments: [{ path: 'docs/alpha.txt', side: 'old', line: 1, endLine: null, text: 'Call it count.' }],
    });
    expect(screen.queryByText('1 comment for the agent')).toBeNull();
    stopFakeServer();
  });
});

describe('changes and files', () => {
  it('lists the changed files as a tree and opens one in place, with no tabs', async () => {
    renderCode(nextTask(), '&mode=changes');
    const tree = await screen.findByRole('tree', { name: 'Changed files' });
    expect(screen.getByText('2 files · 0 viewed')).toBeDefined();
    const added = within(within(tree).getByRole('treeitem', { name: 'docs/beta.txt' })).getByText('A');
    expect(await findTooltipText(added)).toBe('Added');
    fireEvent.click(within(tree).getByRole('treeitem', { name: 'docs/beta.txt' }));
    expect(params().get('file')).toBe('docs/beta.txt');
    expect(params().get('diff')).toBe('1');
    fireEvent.click(within(tree).getByRole('treeitem', { name: 'docs/alpha.txt' }));
    expect(params().get('file')).toBe('docs/alpha.txt');
    expect(screen.queryByRole('tablist', { name: 'Open files' })).toBeNull();
    fireEvent.click(within(tree).getAllByRole('checkbox', { name: 'Viewed' })[0] as HTMLElement);
    expect(screen.getByText('2 files · 1 viewed')).toBeDefined();
    expect(params().get('file')).toBe('docs/alpha.txt');
    expect(
      within(tree)
        .getAllByRole('checkbox', { name: 'Viewed' })
        .map((box) => box.getAttribute('aria-checked'))
    ).toEqual(['true', 'false']);
    fireEvent.click(within(tree).getByRole('treeitem', { name: 'docs/beta.txt' }));
    expect(within(tree).getByRole('treeitem', { name: 'docs/alpha.txt' }).className).toContain('text-fg-1');
    fireEvent.click(screen.getByRole('button', { name: 'Hide viewed files' }));
    expect(screen.getByText('2 files · 1 viewed hidden')).toBeDefined();
    expect(within(tree).queryByRole('treeitem', { name: 'docs/alpha.txt' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Hide viewed files' }));
    expect(within(tree).getByRole('treeitem', { name: 'docs/alpha.txt' })).toBeDefined();
    fireEvent.click(within(tree).getByRole('treeitem', { name: 'docs' }));
    expect(within(tree).queryByRole('treeitem', { name: 'docs/alpha.txt' })).toBeNull();
    fireEvent.click(within(tree).getByRole('treeitem', { name: 'docs' }));
    expect(within(tree).getByRole('treeitem', { name: 'docs/alpha.txt' })).toBeDefined();
  });

  it('marks a folder viewed with every file under it, and says so calmly once nothing is left', async () => {
    renderCode(nextTask(), '&mode=changes&file=docs%2Falpha.txt&diff=1');
    const tree = await screen.findByRole('tree', { name: 'Changed files' });
    const folder = () => within(tree).getByRole('checkbox', { name: 'Viewed: every file in docs' });
    expect(folder().getAttribute('aria-checked')).toBe('false');
    fireEvent.click(within(tree).getAllByRole('checkbox', { name: 'Viewed' })[0] as HTMLElement);
    expect(folder().getAttribute('aria-checked')).toBe('mixed');
    fireEvent.click(folder());
    expect(screen.getByText('2 files · 2 viewed')).toBeDefined();
    expect(folder().getAttribute('aria-checked')).toBe('true');
    expect(within(tree).getByRole('treeitem', { name: 'docs' }).className).toContain('file-icons-muted');
    fireEvent.click(screen.getByRole('button', { name: 'Hide viewed files' }));
    expect(screen.getByText('Every file is viewed.')).toBeDefined();
    expect(within(tree).queryByRole('treeitem', { name: 'docs/alpha.txt' })).toBeNull();
    expect(params().get('file')).toBe('docs/alpha.txt');
    expect(screen.queryByRole('button', { name: 'Show viewed files' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Hide viewed files' }));
    expect(within(tree).getByRole('treeitem', { name: 'docs/alpha.txt' })).toBeDefined();
    fireEvent.click(folder());
    expect(screen.getByText('2 files · 0 viewed')).toBeDefined();
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
    expect(screen.queryByRole('tab', { name: 'Changes' })).toBeNull();
    expect(screen.getByText('Open a file')).toBeDefined();
  });

  it('finds in the open file from ⌘F, with its options, and closes the find bar', async () => {
    renderCode(nextTask(), '&mode=files&file=docs%2Falpha.txt');
    await findLine('two');
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ...MOD }));
    });
    const input = await screen.findByRole('textbox', { name: 'Find in this file' });
    fireEvent.change(input, { target: { value: 'tw' } });
    expect(await screen.findByText('1 found')).toBeDefined();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByText('1 of 1')).toBeDefined();
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    fireEvent.click(screen.getByRole('button', { name: 'Next match' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous match' }));
    const word = screen.getAllByRole('button', { name: 'Match whole word' }).at(-1) as HTMLElement;
    fireEvent.click(word);
    expect(await screen.findByText('No results')).toBeDefined();
    expect(word.getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitForGone(() => screen.queryByRole('textbox', { name: 'Find in this file' }));
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ...MOD }));
    });
    await screen.findByRole('textbox', { name: 'Find in this file' });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitForGone(() => screen.queryByRole('textbox', { name: 'Find in this file' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Match whole word' }));
    await waitFor(() => expect(params().get('q')).toBe('two'), { timeout: 2000 });
    expect(params().get('case')).toBe('1');
    expect(params().get('word')).toBe('1');
    expect(await screen.findByText('1 result in 1 file.')).toBeDefined();
    fireEvent.click(screen.getByRole('treeitem', { name: 'docs/alpha.txt line 2' }));
    expect(params().get('line')).toBe('2');
    expect(params().get('diff')).toBe('1');
  });

  it('invites a search before you type, and says what to loosen when nothing matches', async () => {
    renderCode(nextTask(), '&mode=search');
    expect(await screen.findByText('Search every file')).toBeDefined();
    const input = await screen.findByRole('textbox', { name: 'Search in files' });
    fireEvent.click(screen.getByRole('button', { name: 'Match case' }));
    fireEvent.change(input, { target: { value: 'nowhere' } });
    expect(await screen.findByText('No results', {}, { timeout: 2000 })).toBeDefined();
    expect(screen.getByText('Try again with Match case turned off.')).toBeDefined();
    expect(screen.queryByText('Search every file')).toBeNull();
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
  });

  it('opens Go to file from the button in the file list, with the files opened last first', async () => {
    const task = nextTask();
    renderCode(task, '&mode=files&file=docs%2Fbeta.txt');
    await findLine('guard');
    navigate(`/tasks/${task.id}?tab=code&mode=files&file=docs%2Falpha.txt`);
    await findLine('two');
    fireEvent.click(screen.getAllByRole('button', { name: 'Go to file' })[0] as HTMLElement);
    await screen.findByPlaceholderText('Go to file');
    const recent = await screen.findByRole('group', { name: 'Recently opened' });
    expect(
      within(recent)
        .getAllByRole('option')
        .map((option) => option.textContent)
    ).toEqual(['beta.txtdocs']);
    const rest = screen.getByRole('group', { name: 'Files' });
    expect(
      within(rest)
        .getAllByRole('option')
        .map((option) => option.textContent)
    ).not.toContain('beta.txtdocs');
  });

  it('keeps the empty editor to its hint, with Go to file in the file list', async () => {
    renderCode(nextTask(), '&mode=files');
    await screen.findByText('Open a file');
    const buttons = screen.getAllByRole('button', { name: 'Go to file' });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0] as HTMLElement);
    expect(await screen.findByPlaceholderText('Go to file')).toBeDefined();
  });

  it('shows the open changed file in Files, revealing its folder, and copies its path', async () => {
    const written: string[] = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text: string) => void written.push(text) },
    });
    renderCode(nextTask(), '&file=docs%2Falpha.txt&diff=1');
    await findLine('two');
    expect(screen.queryByRole('button', { name: 'Copy path' })).toBeNull();
    await openFileOptions();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Copy path' }));
    await waitFor(() => expect(written).toEqual(['docs/alpha.txt']));
    await openFileOptions();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Show in Files' }));
    expect(params().get('mode')).toBe('files');
    expect(params().get('file')).toBe('docs/alpha.txt');
    const tree = await screen.findByRole('tree', { name: 'Files' });
    const row = await within(tree).findByRole('treeitem', { name: 'docs/alpha.txt' });
    expect(row.getAttribute('aria-selected')).toBe('true');
  });

  it('opens the file in your editor at its line, only when the task has a checkout', async () => {
    renderCode(nextTask({ worktreePath: '/w' }), '&file=docs%2Falpha.txt&diff=1&line=2');
    await findLine('two');
    await openFileOptions();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Open in editor' }));
    await waitFor(() => expect(writes).toContainEqual({ target: 'editor', path: 'docs/alpha.txt', line: 2 }));
  });

  it('leaves Open in editor out when the task has no checkout', async () => {
    renderCode(nextTask(), '&file=docs%2Falpha.txt&diff=1');
    await findLine('two');
    await openFileOptions();
    await screen.findByRole('menuitem', { name: 'Copy path' });
    expect(screen.queryByRole('menuitem', { name: 'Open in editor' })).toBeNull();
  });

  it('switches to another commit from the ref picker', async () => {
    renderCode(nextTask(), '&mode=files');
    await screen.findByRole('tree', { name: 'Files' });
    expect(screen.getByRole('combobox', { name: 'Show the code at' })).toBeDefined();
  });
});

describe('editing in place', () => {
  beforeEach(() => {
    localStorage.setItem('shinsa.code-preview-file', 'false');
  });

  it('shows a diff side by side first, and unified once you pick it, remembered', async () => {
    renderCode(nextTask());
    fireEvent.click(await screen.findByRole('button', { name: 'Show unified' }));
    expect(localStorage.getItem('shinsa.code-unified')).toBe('true');
    fireEvent.click(await screen.findByRole('button', { name: 'Show side by side' }));
    expect(localStorage.getItem('shinsa.code-unified')).toBe('false');
  });

  it('builds a changed file’s side by side view while its row is hovered, and shows it on the press', async () => {
    renderCode(nextTask(), '&mode=changes&file=docs/beta.txt&diff=1');
    await findLine('guard');
    const tree = await screen.findByRole('tree', { name: 'Changed files' });
    fireEvent.pointerEnter(within(tree).getByRole('treeitem', { name: 'docs/alpha.txt' }));
    await act(() => Bun.sleep(400));
    fireEvent.click(within(tree).getByRole('treeitem', { name: 'docs/alpha.txt' }));
    await findLine('two');
    expect(document.querySelector('.cm-mergeView')).not.toBeNull();
  });

  it('saves what you type to the working copy, with no mode to switch on', async () => {
    renderCode(nextTask({ worktreePath: '/w', stage: 'awaiting_review' }), '&mode=files&file=README.md');
    const line = await findLine('# Sample');
    const view = EditorView.findFromDOM(line as HTMLElement);
    if (!view) throw new Error('No editor');
    act(() => view.dispatch({ changes: { from: 0, insert: 'Hello ' }, userEvent: 'input.type' }));
    expect(screen.getByRole('status').textContent).toBe('Edited');
    await waitFor(
      () => expect(writes).toEqual([{ path: 'README.md', content: 'Hello # Sample\n', base: '# Sample\n' }]),
      { timeout: 5_000 }
    );
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Saved'));
    expect(screen.queryByText(/read-only/)).toBeNull();
  });

  it('keeps the same editor through each save, so you can edit, save and edit again', async () => {
    const disk = { text: '# Sample\n' };
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost');
      const name = url.pathname.split('/').at(-1);
      if (init?.body) {
        const write = JSON.parse(String(init.body)) as { content: string };
        writes.push(write);
        disk.text = write.content;
        return Response.json({ path: 'README.md', changed: true });
      }
      if (name === 'refs') return Response.json({ ...REFS, working: true, dirty: true });
      if (name === 'blob' && url.searchParams.get('ref') === 'working')
        return Response.json({
          ref: 'working',
          path: 'README.md',
          content: disk.text,
          size: disk.text.length,
          binary: false,
          tooLarge: false,
          missing: false,
          image: null,
        });
      return respond(url);
    }) as typeof fetch;
    const task = nextTask({ worktreePath: '/w', stage: 'awaiting_review', updatedAt: 1 });
    const page = (current: Task) => (
      <TooltipProvider>
        <ReviewDraftProvider enabled draftKey={`gate-${task.id}`}>
          <CodeTab task={current} modes={['changes', 'files']} />
        </ReviewDraftProvider>
      </TooltipProvider>
    );
    navigate(`/tasks/${task.id}?tab=code&mode=files&file=README.md`);
    const view = render(page(task));
    const editor = EditorView.findFromDOM((await findLine('# Sample')) as HTMLElement);
    if (!editor) throw new Error('No editor');
    let expected = '# Sample\n';
    for (const word of ['one', 'two', 'three', 'four']) {
      act(() =>
        editor.dispatch({
          changes: { from: editor.state.doc.length, insert: `${word}\n` },
          userEvent: 'input.type',
        })
      );
      expected += `${word}\n`;
      await waitFor(() => expect(disk.text).toBe(expected), { timeout: 5_000 });
      view.rerender(page({ ...task, editedPaths: ['README.md'], updatedAt: writes.length + 1 }));
      await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
      expect(editor.dom.isConnected).toBe(true);
      expect(editor.state.readOnly).toBe(false);
      expect(editor.state.doc.toString()).toBe(expected);
    }
    expect(writes.map((write) => (write as { base: string }).base)).toEqual([
      '# Sample\n',
      '# Sample\none\n',
      '# Sample\none\ntwo\n',
      '# Sample\none\ntwo\nthree\n',
    ]);
  });

  it('shows a whole new file on its own side at full width, with no layout to switch', async () => {
    renderCode(nextTask(), '&mode=changes&file=docs/beta.txt&diff=1');
    await findLine('guard');
    expect(document.querySelector('.cm-mergeView')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show unified' })).toBeNull();
  });

  it('holds back a file with a line too long to show until you open it anyway', async () => {
    HEAD_FILES['long.min.js'] = `${'x'.repeat(10_001)}\n`;
    try {
      renderCode(nextTask(), '&mode=files&file=long.min.js');
      expect(
        await screen.findByText('long.min.js has a line of 10,001 characters, too long to show as text.')
      ).toBeDefined();
      fireEvent.click(screen.getByRole('button', { name: 'Open anyway' }));
      await waitFor(() => expect(document.querySelector('.cm-line')).not.toBeNull());
    } finally {
      delete HEAD_FILES['long.min.js'];
    }
  });

  it('says why an earlier commit or a task with no checkout is read-only', async () => {
    renderCode(
      nextTask({ worktreePath: '/w', stage: 'awaiting_review' }),
      `&mode=files&file=README.md&ref=${BASE}`
    );
    expect(
      await screen.findByText(
        'This is an earlier commit, so it is read-only. Pick Head of the branch to edit.'
      )
    ).toBeDefined();
  });
});

describe('Markdown preview', () => {
  it('shows a Markdown file rendered, and its source once you pick it, remembered', async () => {
    renderCode(nextTask(), '&mode=files&file=README.md');
    const preview = await screen.findByRole('article', { name: 'Preview of README.md' });
    expect(within(preview).getByRole('heading', { level: 1 }).textContent).toBe('Sample');
    expect(document.querySelector('.cm-editor')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show source' }));
    await findLine('# Sample');
    expect(screen.queryByRole('article', { name: 'Preview of README.md' })).toBeNull();
    expect(localStorage.getItem('shinsa.code-preview-file')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Show preview' }));
    expect(await screen.findByRole('article', { name: 'Preview of README.md' })).toBeDefined();
  });

  it('shows the new text when the file changes on disk while you read its preview', async () => {
    const disk = { text: '# Sample\n' };
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost');
      const name = url.pathname.split('/').at(-1);
      if (name === 'refs') return Response.json({ ...REFS, working: true, dirty: true });
      if (name === 'blob' && url.searchParams.get('ref') === 'working')
        return Response.json({
          ref: 'working',
          path: 'README.md',
          content: disk.text,
          size: disk.text.length,
          binary: false,
          tooLarge: false,
          missing: false,
          image: null,
        });
      return respond(url);
    }) as typeof fetch;
    const task = nextTask({
      worktreePath: '/w',
      stage: 'awaiting_review',
      editedPaths: ['README.md'],
      updatedAt: 1,
    });
    const page = (current: Task) => (
      <TooltipProvider>
        <ReviewDraftProvider enabled draftKey={`gate-${task.id}`}>
          <CodeTab task={current} modes={['changes', 'files']} />
        </ReviewDraftProvider>
      </TooltipProvider>
    );
    navigate(`/tasks/${task.id}?tab=code&mode=files&file=README.md`);
    const view = render(page(task));
    const preview = await screen.findByRole('article', { name: 'Preview of README.md' });
    await waitFor(() =>
      expect(within(preview).getByRole('heading', { level: 1 }).textContent).toBe('Sample')
    );
    disk.text = '# Rewritten\n';
    view.rerender(page({ ...task, updatedAt: 2 }));
    await waitFor(
      () =>
        expect(
          within(screen.getByRole('article', { name: 'Preview of README.md' })).getByRole('heading', {
            level: 1,
          }).textContent
        ).toBe('Rewritten'),
      { timeout: 5_000 }
    );
  });

  it('offers no preview for a file that is not Markdown', async () => {
    renderCode(nextTask(), '&mode=files&file=docs/beta.txt');
    await findLine('guard');
    expect(screen.queryByRole('button', { name: 'Show preview' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show source' })).toBeNull();
  });

  it('opens a file the preview links to in the Code tab, at its line', async () => {
    HEAD_FILES['docs/guide.md'] = 'See [the alpha notes](alpha.txt#L2) and [the readme](../README.md).\n';
    try {
      renderCode(nextTask(), '&mode=files&file=docs/guide.md');
      const preview = await screen.findByRole('article', { name: 'Preview of docs/guide.md' });
      fireEvent.click(within(preview).getByRole('link', { name: 'the alpha notes' }));
      await waitFor(() => expect(params().get('file')).toBe('docs/alpha.txt'));
      expect(params().get('diff')).toBe('1');
      expect(params().get('line')).toBe('2');
    } finally {
      delete HEAD_FILES['docs/guide.md'];
    }
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
