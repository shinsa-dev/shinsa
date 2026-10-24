import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { DiffFile, Task, TaskDiff, WorkReport } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ReviewPane } from '@/components/code/review.tsx';
import { ReviewDraftProvider } from '@/components/task/review-draft.tsx';
import { createTask } from '../../support/state.ts';

const realFetch = globalThis.fetch;

const CONTENT: Record<string, string> = {
  'docs/alpha.txt': 'one\ntwo\nthree\n',
  'docs/beta.txt': 'guard\n',
  'docs/gamma.txt': 'a\nb\nc\nfourth line\n',
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
    createFile({ path: 'docs/alpha.txt', patch: '@@ -1,2 +1,3 @@\n one\n+two\n three\n' }),
    createFile({
      path: 'docs/beta.txt',
      status: 'added',
      risk: 'high',
      riskReason: 'Touches the input guard.',
      patch: '@@ -0,0 +1,1 @@\n+guard\n',
    }),
    createFile({ path: 'docs/gamma.txt', risk: 'low', patch: '@@ -3,1 +3,2 @@\n c\n+fourth line\n' }),
  ],
};

const REPORT: WorkReport = {
  headline: 'Parses the input and guards it.',
  phases: [
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
  checks: [],
  decisions: [
    {
      decision: 'Kept the old reader',
      reason: 'Other callers still use it.',
      file: 'docs/gamma.txt',
      line: 4,
    },
  ],
};

let taskCount = 0;

function nextTask(overrides: Partial<Task> = {}) {
  taskCount += 1;
  return createTask({ id: `review-${taskCount}`, report: REPORT, ...overrides });
}

beforeEach(() => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost');
    const path = url.searchParams.get('path') ?? '';
    if (!url.pathname.endsWith('/file')) return new Response('not found', { status: 404 });
    return Response.json({ content: CONTENT[path] ?? null });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function renderPane(task: Task, diff: TaskDiff = DIFF) {
  return render(
    <TooltipProvider>
      <ReviewDraftProvider enabled draftKey={task.id}>
        <ReviewPane task={task} diff={diff} />
      </ReviewDraftProvider>
    </TooltipProvider>
  );
}

function listSpotReasons() {
  return screen
    .getAllByText(/^(Adds the second line|Rejects empty input)\.$/)
    .map((element) => element.textContent);
}

function spotFor(why: string) {
  return screen.getByText(why).closest('button') as HTMLButtonElement;
}

function toolbar() {
  return screen.getByText(/^\d+ of \d+$/).parentElement as HTMLElement;
}

describe('the review pane', () => {
  it('reorders the spots by attention and opens the first spot of the new order', async () => {
    renderPane(nextTask());
    expect(await screen.findByText('two')).toBeDefined();
    expect(screen.getByText('Parses the input and guards it.')).toBeDefined();
    expect(screen.getByText('Wire the parser')).toBeDefined();
    expect(listSpotReasons()).toEqual(['Adds the second line.', 'Rejects empty input.']);
    fireEvent.click(screen.getByRole('tab', { name: 'By attention' }));
    expect(listSpotReasons()).toEqual(['Rejects empty input.', 'Adds the second line.']);
    expect(screen.queryByText('Reads one more line.')).toBeNull();
    expect(screen.getByText('Wire the parser')).toBeDefined();
    expect(spotFor('Rejects empty input.').getAttribute('aria-current')).toBe('true');
    expect(await screen.findByText('guard')).toBeDefined();
    fireEvent.click(screen.getByRole('tab', { name: 'Walkthrough' }));
    expect(listSpotReasons()).toEqual(['Adds the second line.', 'Rejects empty input.']);
    expect(await screen.findByText('two')).toBeDefined();
  });

  it('steps through the spots with the next and previous buttons', async () => {
    renderPane(nextTask());
    expect(spotFor('Adds the second line.').getAttribute('aria-current')).toBe('true');
    expect(within(toolbar()).getByText('1 of 2')).toBeDefined();
    expect(await screen.findByText('two')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Next spot' }));
    expect(spotFor('Rejects empty input.').getAttribute('aria-current')).toBe('true');
    expect(spotFor('Adds the second line.').getAttribute('aria-current')).toBeNull();
    expect(within(toolbar()).getByText('2 of 2')).toBeDefined();
    expect(within(toolbar()).getByText('beta.txt')).toBeDefined();
    expect(await screen.findByText('guard')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Previous spot' }));
    expect(spotFor('Adds the second line.').getAttribute('aria-current')).toBe('true');
    expect(within(toolbar()).getByText('1 of 2')).toBeDefined();
    expect(await screen.findByText('two')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Previous spot' }));
    expect(within(toolbar()).getByText('2 of 2')).toBeDefined();
    expect(await screen.findByText('guard')).toBeDefined();
  });

  it('selects the spot a person clicks', async () => {
    renderPane(nextTask());
    fireEvent.click(spotFor('Rejects empty input.'));
    expect(await screen.findByText('guard')).toBeDefined();
    expect(spotFor('Rejects empty input.').getAttribute('aria-current')).toBe('true');
    expect(within(toolbar()).getByText('2 of 2')).toBeDefined();
  });

  it('jumps to the file and line of a judgement call', async () => {
    renderPane(nextTask());
    expect(screen.getByText('Judgement calls')).toBeDefined();
    expect(screen.getByText('Kept the old reader')).toBeDefined();
    expect(screen.getByText('Other callers still use it.')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'docs/gamma.txt:4' }));
    expect(within(toolbar()).getByText('gamma.txt')).toBeDefined();
    expect(within(toolbar()).getByText('4')).toBeDefined();
    expect(spotFor('Adds the second line.').getAttribute('aria-current')).toBeNull();
    expect(spotFor('Rejects empty input.').getAttribute('aria-current')).toBeNull();
    expect(await screen.findByText('fourth line')).toBeDefined();
  });

  it('builds the spots from the riskiest hunks when the hand-over has no work report', async () => {
    renderPane(nextTask({ report: null, summary: 'Older hand-over.' }));
    expect(screen.getByText('Older hand-over.')).toBeDefined();
    expect(
      screen.getByText(
        'This hand-over predates the review protocol, so the spots come from the riskiest hunks.'
      )
    ).toBeDefined();
    expect(screen.getByText('Look closely')).toBeDefined();
    expect(screen.getByText('Touches the input guard.')).toBeDefined();
    expect(screen.getByText('The main change')).toBeDefined();
    expect(screen.getByText('Tests and docs')).toBeDefined();
    expect(screen.getAllByText('Changed lines.')).toHaveLength(2);
    expect(within(toolbar()).getByText('1 of 3')).toBeDefined();
    expect(within(toolbar()).getByText('beta.txt')).toBeDefined();
    expect(screen.queryByText('Judgement calls')).toBeNull();
    expect(await screen.findByText('guard')).toBeDefined();
  });

  it('says so when a spot points at a file outside the change', () => {
    const report: WorkReport = {
      ...REPORT,
      phases: [
        {
          title: 'Elsewhere',
          summary: 'A file the change never touched.',
          spots: [{ file: 'docs/missing.txt', start: 3, end: 5, attention: 'high', why: 'Looks here.' }],
        },
      ],
      decisions: [],
    };
    renderPane(nextTask({ report }));
    expect(
      screen.getByText(
        'docs/missing.txt is not part of this change. The agent may have pointed at the wrong file.'
      )
    ).toBeDefined();
    expect(within(toolbar()).getByText('3–5')).toBeDefined();
  });

  it('lists a line comment under the reviewer’s comments with its place', async () => {
    renderPane(nextTask());
    fireEvent.click(await screen.findByRole('button', { name: 'Comment on line 2' }));
    const field = screen.getByRole('textbox', { name: 'Comment' });
    expect((screen.getByRole('button', { name: 'Add comment' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(field, { target: { value: 'Name this line.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add comment' }));
    await waitFor(() => {
      expect(screen.getByText('Your comments')).toBeDefined();
    });
    expect(screen.queryByRole('textbox', { name: 'Comment' })).toBeNull();
    expect(screen.getByText('docs/alpha.txt:2')).toBeDefined();
    expect(screen.getAllByText('Name this line.')).toHaveLength(2);
  });

  it('drops a comment the reviewer cancels', async () => {
    renderPane(nextTask());
    fireEvent.click(await screen.findByRole('button', { name: 'Comment on line 2' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Comment' }), { target: { value: 'Never mind.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('textbox', { name: 'Comment' })).toBeNull();
    expect(screen.queryByText('Your comments')).toBeNull();
  });
});
