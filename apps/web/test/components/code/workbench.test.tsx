import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { EditorView } from '@codemirror/view';
import type { DiffFile, Task, TaskDiff, TaskRefs, WorkReport } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ReviewDraftProvider } from '@/components/task/review-draft.tsx';
import { navigate } from '@/router.ts';
import { CodeTab } from '@/routes/task/code.tsx';
import { createTask } from '../../support/state.ts';
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
  checks: [{ name: 'bun test', outcome: 'pass', detail: '12 tests' }],
  judgementCalls: [
    { call: 'Kept the old reader', reason: 'Other callers still use it.', file: 'README.md', line: 1 },
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
  if (name === 'search') {
    const lines = [
      { kind: 'matches', matches: [{ path: 'docs/alpha.txt', line: 2, column: 1, text: 'two' }] },
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
    expect(await screen.findByText('Wrong word')).toBeDefined();
    expect(screen.getByText('Agent review')).toBeDefined();
    expect(screen.getByText('Blocking')).toBeDefined();
    expect(screen.getByText('Suggested fix')).toBeDefined();
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
});

describe('changes and files', () => {
  it('lists the changed files as a tree and opens one in place, with no tabs', async () => {
    renderCode(nextTask(), '&mode=changes');
    const tree = await screen.findByRole('tree', { name: 'Changed files' });
    expect(screen.getByText('2 files · 0 viewed')).toBeDefined();
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

  it('switches to another commit from the ref picker', async () => {
    renderCode(nextTask(), '&mode=files');
    await screen.findByRole('tree', { name: 'Files' });
    expect(screen.getByRole('combobox', { name: 'Show the code at' })).toBeDefined();
  });
});

describe('editing in place', () => {
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
    await waitFor(
      () => expect(writes).toEqual([{ path: 'README.md', content: 'Hello # Sample\n', base: '# Sample\n' }]),
      { timeout: 5_000 }
    );
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
