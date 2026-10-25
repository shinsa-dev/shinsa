import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { DiffFile, ShinsaState, Task, TaskDiff, TaskRefs, WorkReport } from '@shinsa/core';
import { Toaster, toast } from '@shinsa/ui/components/sonner';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ReviewDraftProvider } from '@/components/task/review-draft.tsx';
import { writeStoredComments } from '@/lib/review/draft.ts';
import { navigate } from '@/router.ts';
import { ReviewTab } from '@/routes/task/review.tsx';
import { listSentCommands, pushState, startFakeServer, stopFakeServer } from '../../support/server.ts';
import { createGate, createShinsaState, createTask } from '../../support/state.ts';

const HEAD = 'c'.repeat(40);
const BASE = 'd'.repeat(40);

const REFS: TaskRefs = {
  head: HEAD,
  base: BASE,
  branch: 'feat/retry',
  defaultBranch: 'main',
  working: false,
  dirty: false,
  commits: [],
};

function diffFile(path: string, overrides: Partial<DiffFile> = {}): DiffFile {
  return {
    path,
    previousPath: null,
    status: 'modified',
    additions: 2,
    deletions: 1,
    risk: 'normal',
    riskReason: null,
    binary: false,
    patch: '@@ -1,2 +1,3 @@\n one\n+two\n three\n',
    ...overrides,
  };
}

const DIFF: TaskDiff = {
  base: BASE,
  head: HEAD,
  files: [
    diffFile('src/retry.ts'),
    diffFile('src/other.ts'),
    diffFile('assets/logo.png', { binary: true, risk: 'high', riskReason: 'Binary.' }),
  ],
};

const REPORT: WorkReport = {
  headline: 'Retries a failed request **three** times.',
  sections: [
    {
      title: 'Retry the request',
      summary: 'Wraps the call in a loop.',
      spots: [
        { file: 'src/retry.ts', start: 2, end: 2, attention: 'critical', why: 'The loop can spin.' },
        { file: 'src/retry.ts', start: 1, end: 1, attention: 'normal', why: 'Imports the helper.' },
      ],
    },
  ],
  checks: [
    { name: 'bun test', outcome: 'pass', detail: '12 tests' },
    { name: 'bun lint', outcome: 'fail', detail: null },
  ],
  judgementCalls: [{ call: 'Three tries', reason: 'Matches the rest.', file: null, line: null }],
};

const realFetch = globalThis.fetch;

beforeEach(() => {
  startFakeServer();
  toast.dismiss();
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost');
    const name = url.pathname.split('/').at(-1);
    if (name === 'refs') return Response.json(REFS);
    if (name === 'diff') return Response.json(DIFF);
    if (name === 'blob') {
      const path = url.searchParams.get('path') ?? '';
      return Response.json({
        ref: url.searchParams.get('ref'),
        path,
        content: url.searchParams.get('ref') === BASE ? 'one\nthree\n' : 'one\ntwo\nthree\n',
        size: 4,
        binary: false,
        tooLarge: false,
        missing: false,
        image: null,
      });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
});

afterEach(() => {
  stopFakeServer();
  globalThis.fetch = realFetch;
  localStorage.clear();
});

let count = 0;

function reviewing(overrides: Partial<Task> = {}, gateType: 'review' | 'merge' | null = 'review') {
  count += 1;
  const id = `review-${count}`;
  const task = createTask({
    id,
    repoId: 'repo-1',
    stage: 'awaiting_review',
    report: REPORT,
    reviewSummary: 'I ran the retry against a server that **drops** the first call.',
    findings: [
      {
        severity: 'suggestion',
        file: 'src/other.ts',
        line: 1,
        message: 'Name the constant.',
        title: 'A bare number',
      },
      {
        severity: 'blocking',
        file: 'src/retry.ts',
        line: 2,
        end: 3,
        message: 'The loop never stops when the call keeps failing.',
        title: 'The retry never ends',
        fix: 'Stop after `3` tries.',
      },
    ],
    ...overrides,
  });
  const gates = gateType ? [createGate({ id: `gate-${id}`, taskId: id, type: gateType })] : [];
  return { task, state: createShinsaState({ tasks: [task], gates }) };
}

function renderReview(state: ShinsaState, task: Task, query = '') {
  navigate(`/tasks/${task.id}?tab=review${query}`);
  pushState(state);
  return render(
    <TooltipProvider>
      <ReviewDraftProvider enabled draftKey={`gate-${task.id}`}>
        <ReviewTab state={state} task={task} />
      </ReviewDraftProvider>
      <Toaster />
    </TooltipProvider>
  );
}

function selectedKey() {
  return document.querySelector('[data-selected]')?.getAttribute('data-review-item') ?? null;
}

describe('the Review tab', () => {
  it('reads top to bottom: what changed, what needs you most critical first, the walkthrough, the review and checks', async () => {
    const { task, state } = reviewing();
    renderReview(state, task);
    expect(await screen.findByText('The retry never ends')).toBeDefined();
    expect(document.body.textContent).toContain('Retries a failed request three times.');
    expect(screen.getByText('3 places need your attention, the most critical first.')).toBeDefined();
    const items = [...document.querySelectorAll('[data-review-item]')].map((item) =>
      item.getAttribute('data-review-item')
    );
    expect(items).toEqual(['finding:1', 'finding:0', 'call:0']);
    expect(screen.getByText('The retry never ends')).toBeDefined();
    expect(screen.getByText('The agent marked these lines')).toBeDefined();
    expect(screen.getByText('Suggested fix')).toBeDefined();
    expect(screen.getByText('Walkthrough')).toBeDefined();
    expect(screen.getByText('Wraps the call in a loop.')).toBeDefined();
    expect(screen.getByText('Found 1 blocking finding and 1 suggestion.')).toBeDefined();
    expect(screen.getByText('drops')).toBeDefined();
    expect(screen.getByText('bun lint')).toBeDefined();
    expect(screen.queryByText('Changed files the review does not point at')).toBeNull();
    fireEvent.click(await screen.findByText('Everything else'));
    expect(screen.getByText('Changed files the review does not point at')).toBeDefined();
    expect(screen.getByText('Binary')).toBeDefined();
  });

  it('steps through the places with J and K, ⌘K and the buttons, and keeps the place in the URL', async () => {
    const { task, state } = reviewing();
    renderReview(state, task);
    await screen.findByText('The retry never ends');
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' }));
    });
    await waitFor(() => expect(selectedKey()).toBe('finding:1'));
    expect(new URLSearchParams(location.search).get('spot')).toBe('finding:1');
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' }));
    });
    await waitFor(() => expect(selectedKey()).toBe('finding:0'));
    fireEvent.click(screen.getByRole('button', { name: 'Previous place' }));
    await waitFor(() => expect(selectedKey()).toBe('finding:1'));
    fireEvent.click(screen.getByRole('button', { name: 'Next place' }));
    await waitFor(() => expect(selectedKey()).toBe('finding:0'));
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x' }));
    });
    expect(selectedKey()).toBe('finding:0');
  });

  it('opens on the place a link names', async () => {
    const { task, state } = reviewing();
    renderReview(state, task, '&spot=call%3A0');
    await screen.findByText('Three tries');
    expect(selectedKey()).toBe('call:0');
  });

  it('decides on each finding and sends the decision from the same action as the Overview', async () => {
    const { task, state } = reviewing();
    renderReview(state, task);
    const fix = await screen.findByRole('button', { name: 'Fix 1 finding' });
    fireEvent.click(screen.getAllByRole('tab', { name: 'Fix' })[1] as HTMLElement);
    expect(await screen.findByRole('button', { name: 'Fix 2 findings' })).toBeDefined();
    fireEvent.click(screen.getAllByRole('tab', { name: 'Dismiss' })[0] as HTMLElement);
    fireEvent.click(screen.getAllByRole('tab', { name: 'Dismiss' })[1] as HTMLElement);
    expect(fix.textContent).toBe('Approve changes');
    fireEvent.click(fix);
    await waitFor(() =>
      expect(listSentCommands()).toMatchObject([{ type: 'gate.answer', gateId: `gate-${task.id}` }])
    );
  });

  it('lists your comments, removes one, and merges at the merge gate', async () => {
    const { task, state } = reviewing({ stage: 'awaiting_merge' }, 'merge');
    writeStoredComments(`gate-${task.id}`, [
      { id: 'c1', path: 'src/retry.ts', side: 'new', line: 1, endLine: null, ref: null, text: 'Say why.' },
    ]);
    renderReview(state, task);
    expect(await screen.findByText('Your comments')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Merge' })).toBeDefined();
    expect(screen.queryByRole('tab', { name: 'Dismiss' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(screen.queryByText('Your comments')).toBeNull());
  });

  it('picks the places from the riskiest changes when the agent handed over no report, with no decision after the merge', async () => {
    const { task, state } = reviewing(
      { report: null, findings: [], reviewSummary: null, summary: 'Older hand-over.', stage: 'merged' },
      null
    );
    renderReview(state, task);
    expect(await screen.findByText('Older hand-over.')).toBeDefined();
    expect(
      screen.getByText(
        'The agent handed over no report, so Shinsa picked these places from the riskiest changes.'
      )
    ).toBeDefined();
    expect(screen.getByText('The agent review has not run yet.')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Approve changes' })).toBeNull();
  });

  it('says so when the changes cannot be read', async () => {
    globalThis.fetch = (async () => new Response('gone', { status: 500 })) as unknown as typeof fetch;
    const { task, state } = reviewing({ report: null });
    renderReview(state, task);
    await waitFor(() => expect(document.body.textContent).not.toContain('Reading the changes'));
  });
});
