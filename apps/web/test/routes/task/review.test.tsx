import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import {
  type DiffFile,
  type MergeStep,
  resolveMergeStepKey,
  type ShinsaState,
  type Task,
  type TaskDiff,
  type TaskRefs,
  type WorkReport,
} from '@shinsa/core';
import { Toaster, toast } from '@shinsa/ui/components/sonner';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TaskCommandRunner } from '@/components/task/command-runner.tsx';
import { ReviewDraftProvider } from '@/components/task/review-draft.tsx';
import * as evidenceLayout from '@/lib/evidence/layout.ts';
import { writeStoredComments } from '@/lib/review/draft.ts';
import * as identity from '@/lib/review/identity.ts';
import { resolveCodePath } from '@/lib/review/places.ts';
import { navigate } from '@/router.ts';
import { ReviewTab } from '@/routes/task/review.tsx';
import { listSentCommands, pushState, startFakeServer, stopFakeServer } from '../../support/server.ts';
import {
  createEvidence,
  createGate,
  createProject,
  createRun,
  createShinsaState,
  createTask,
} from '../../support/state.ts';

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
    { id: 'c1', label: 'Tests', command: 'bun test', outcome: 'pass', detail: '12 tests' },
    { id: 'c2', label: 'Lint', command: 'bun lint', outcome: 'fail', detail: null },
  ],
  judgementCalls: [
    {
      title: 'Retry three times',
      call: 'Three tries',
      reason: 'Matches the rest.',
      file: null,
      line: null,
      alternatives: [{ option: 'Five tries', rejected: 'Holds the user too long.' }],
    },
  ],
  walkthrough: {
    approach: 'Wrap the call in a **bounded** loop.',
    flow: '```text\ncall → retry → give up\n```',
    risks: [
      { title: 'Retries a bad request', risk: 'A 400 retries too.', file: 'src/retry.ts', line: 2, end: 2 },
    ],
    testing: { automated: ['Drop the first call and watch it retry.'], manual: [] },
  },
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
    checks: [
      { id: 'c1', label: 'Tests', command: 'bun test', phases: [1], source: 'plan' },
      { id: 'c2', label: 'Lint', command: 'bun lint', phases: [1], source: 'agent' },
    ],
    checkResults: REPORT.checks,
    reviewSummary: 'I ran the retry against a server that **drops** the first call.',
    findings: [
      {
        severity: 'optional',
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

function ReviewTree({ state, task }: { state: ShinsaState; task: Task }) {
  return (
    <TooltipProvider>
      <ReviewDraftProvider enabled draftKey={`gate-${task.id}`}>
        <TaskCommandRunner state={state} task={task}>
          <ReviewTab state={state} task={task} />
        </TaskCommandRunner>
      </ReviewDraftProvider>
      <Toaster />
    </TooltipProvider>
  );
}

function renderReview(state: ShinsaState, task: Task, query = '') {
  navigate(`/tasks/${task.id}?tab=review${query}`);
  pushState(state);
  return render(<ReviewTree state={state} task={task} />);
}

function selectedKey() {
  return (
    document.querySelector('[data-review-item][data-selected]')?.getAttribute('data-review-item') ?? null
  );
}

describe('the Review tab', () => {
  it('reads top to bottom: how it is built and tested, the key code, the judgement calls, what to read carefully and the review', async () => {
    const { task, state } = reviewing({
      reviewDisagreements: [{ call: 'Three tries', reason: 'Two is enough here.' }],
    });
    renderReview(state, task);
    expect(await screen.findAllByText('The loop never stops when the call keeps failing.')).toBeDefined();
    expect(document.body.textContent).toContain('Retries a failed request three times.');
    expect(
      screen.getByText(
        '6 points to read, 1 blocking, 1 critical, 1 judgement call, 1 disputed by the agent review.'
      )
    ).toBeDefined();
    expect(screen.getByText('Every point')).toBeDefined();
    const items = [...document.querySelectorAll('[data-review-item]')].map((item) =>
      item.getAttribute('data-review-item')
    );
    expect(items).toEqual([
      'approach',
      'flow',
      'testing',
      '0:1',
      'call:0',
      '0:0',
      'risk:0',
      'finding:1',
      'finding:0',
    ]);
    for (const item of document.querySelectorAll('[data-review-item]'))
      expect(item.className).toContain('[content-visibility:auto]');
    for (const heading of [
      'How it’s built',
      'Approach',
      'How it works',
      'Key code',
      'Judgement calls',
      'Read carefully',
      'Risks and edge cases',
      'How to test',
      'Agent review',
    ])
      expect(screen.getAllByText(heading).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Collapse agent review' }).textContent).toBe('Agent review2');
    expect(screen.getByRole('button', { name: 'Collapse risks and edge cases' }).textContent).toBe(
      'Risks and edge cases1'
    );
    expect(screen.getByText('bounded')).toBeDefined();
    const call = document.querySelector('[data-review-item="call:0"]') as HTMLElement;
    expect(call.querySelector('.bg-bg-a1')?.textContent).toContain('Retry three times');
    expect(call.querySelector('.bg-bg-a1')?.textContent).not.toContain('Agent');
    expect(call.textContent).toContain('Three tries');
    expect(document.querySelector('[data-review-item="risk:0"]')?.textContent).toContain(
      'Retries a bad request'
    );
    expect(screen.getByText('Also considered')).toBeDefined();
    expect(screen.getByText('Holds the user too long.')).toBeDefined();
    expect(screen.getByText('The agent review disagrees')).toBeDefined();
    expect(screen.getByText('Two is enough here.')).toBeDefined();
    expect(screen.getByText('Drop the first call and watch it retry.')).toBeDefined();
    expect(screen.getByText('1 of 2 failed')).toBeDefined();
    expect(screen.getByText('bun lint')).toBeDefined();
    expect(screen.getByText('Proposed fix')).toBeDefined();
    expect(
      screen.getByText('Found 2 findings: 1 blocking, 1 optional. A signal for you, never the approval.')
    ).toBeDefined();
    expect(screen.getByText('drops')).toBeDefined();
    expect(screen.queryByText('Changed files the review does not point at')).toBeNull();
    fireEvent.click(await screen.findByText('Everything else'));
    expect(await screen.findByText('Changed files the review does not point at')).toBeDefined();
    expect(screen.getByText('Binary')).toBeDefined();
  });

  it('pins every point to the top as one line that opens the whole list, grouped by chapter', async () => {
    const { task, state } = reviewing();
    renderReview(state, task);
    await screen.findAllByText('The loop never stops when the call keeps failing.');
    const index = screen.getByRole('button', { name: 'Every point' });
    expect(index.textContent).toBe('Every point6');
    fireEvent.click(index);
    const list = await screen.findByRole('dialog');
    expect(
      [...list.querySelectorAll('ol')].map((group) => group.previousElementSibling?.textContent)
    ).toEqual(['How it’s built', 'Key code', 'Judgement calls', 'Read carefully', 'Agent review']);
    const leading = (title: string) =>
      screen.getByText(title, { selector: 'button *' }).closest('button')?.firstElementChild;
    expect(leading('Approach')?.querySelector('svg')).not.toBeNull();
    expect(leading('How it works')?.querySelector('svg')).not.toBeNull();
    expect(leading('A bare number')?.textContent).toBe('6');
    fireEvent.click(screen.getByText('A bare number', { selector: 'button *' }));
    await waitFor(() => expect(selectedKey()).toBe('finding:0'));
    expect(new URLSearchParams(location.search).get('spot')).toBe('finding:0');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(index.textContent).toBe('Every point6 of 6·Agent review·A bare number');
  });

  it('follows the point you scroll to, once you take over from the jump', async () => {
    const { task, state } = reviewing();
    renderReview(state, task, '&spot=0%3A1');
    await screen.findAllByText('The loop never stops when the call keeps failing.');
    const viewport = document.querySelector('[data-slot="scroll-area-viewport"]') as HTMLElement;
    const keys = [...document.querySelectorAll('[data-review-item]')].map((item) =>
      item.getAttribute('data-review-item')
    );
    const realRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function rect(this: HTMLElement) {
      const at = keys.indexOf(this.dataset.reviewItem ?? '');
      return { ...realRect.call(this), top: at < 0 ? 0 : at * 100 - 360 };
    };
    Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: 2000 });
    try {
      fireEvent.scroll(viewport);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const index = screen.getByRole('button', { name: 'Every point' });
      expect(index.textContent).toContain('Key code');
      act(() => {
        window.dispatchEvent(new Event('wheel'));
      });
      fireEvent.scroll(viewport);
      await waitFor(() =>
        expect(index.textContent).toBe('Every point2 of 6·Judgement calls·Retry three times')
      );
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' }));
      });
      await waitFor(() => expect(selectedKey()).toBe('0:0'));
      Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: 0 });
      Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 600 });
      act(() => {
        window.dispatchEvent(new Event('wheel'));
      });
      fireEvent.scroll(viewport);
      await waitFor(() => expect(index.textContent).toBe('Every point6 of 6·Agent review·A bare number'));
    } finally {
      HTMLElement.prototype.getBoundingClientRect = realRect;
    }
  });

  it('renders only the index and the lit point while you scroll and step, never the whole review', async () => {
    const { task, state } = reviewing();
    renderReview(state, task);
    await screen.findAllByText('The loop never stops when the call keeps failing.');
    fireEvent.click(await screen.findByText('Everything else'));
    await screen.findByText('Binary');
    await act(async () => {});
    const viewport = document.querySelector('[data-slot="scroll-area-viewport"]') as HTMLElement;
    const keys = [...document.querySelectorAll('[data-review-item]')].map((item) =>
      item.getAttribute('data-review-item')
    );
    const realRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function rect(this: HTMLElement) {
      const at = keys.indexOf(this.dataset.reviewItem ?? '');
      return { ...realRect.call(this), top: at < 0 ? 0 : at * 100 - 360 };
    };
    Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: 2000 });
    const cards = spyOn(identity, 'resolveReviewItemIdentity');
    try {
      const index = screen.getByRole('button', { name: 'Every point' });
      fireEvent.scroll(viewport);
      await waitFor(() =>
        expect(index.textContent).toBe('Every point2 of 6·Judgement calls·Retry three times')
      );
      expect(cards).not.toHaveBeenCalled();
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' }));
      });
      await waitFor(() => expect(selectedKey()).not.toBeNull());
      expect(cards).not.toHaveBeenCalled();
    } finally {
      cards.mockRestore();
      HTMLElement.prototype.getBoundingClientRect = realRect;
    }
  });

  it('renders no evidence or point card again when the state changes for another task', async () => {
    const { task, state } = reviewing();
    const withEvidence = {
      ...state,
      evidence: {
        shot: createEvidence({ id: 'shot', taskId: task.id, title: 'Settings page', label: 'Empty' }),
      },
    };
    const view = renderReview(withEvidence, task);
    await screen.findAllByText('The loop never stops when the call keeps failing.');
    const figure = await screen.findByRole('button', { name: /^Open Settings page/ });
    await act(async () => {});
    const cards = spyOn(identity, 'resolveReviewItemIdentity');
    const figures = spyOn(evidenceLayout, 'describeEvidencePart');
    try {
      const other = createTask({ id: 'other', title: 'Another task', stage: 'building' });
      const patched: ShinsaState = {
        ...withEvidence,
        tasks: { ...withEvidence.tasks, other },
        runs: { ...withEvidence.runs, 'other-run': createRun({ id: 'other-run', taskId: 'other' }) },
        evidence: {
          ...withEvidence.evidence,
          'other-shot': createEvidence({ id: 'other-shot', taskId: 'other' }),
        },
      };
      view.rerender(<ReviewTree state={patched} task={task} />);
      await act(async () => {});
      expect(figure.isConnected).toBe(true);
      expect(cards).not.toHaveBeenCalled();
      expect(figures).not.toHaveBeenCalled();
    } finally {
      cards.mockRestore();
      figures.mockRestore();
    }
  });

  it('scrolls to the stop you pick in its own tab while another task’s Review tab stays mounted and hidden', async () => {
    const hidden = reviewing();
    const { task } = reviewing();
    const both = createShinsaState({ tasks: [hidden.task, task] });
    navigate(`/tasks/${task.id}?tab=review`);
    pushState(both);
    render(
      <>
        <div hidden>
          <ReviewTree state={both} task={hidden.task} />
        </div>
        <ReviewTree state={both} task={task} />
      </>
    );
    await waitFor(() => expect(document.querySelectorAll('[data-review-item="approach"]')).toHaveLength(2));
    const [, shown] = [...document.querySelectorAll<HTMLElement>('[data-review-item="approach"]')];
    const scrolled: HTMLElement[] = [];
    const realScroll = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = function scroll(this: HTMLElement) {
      scrolled.push(this);
    };
    try {
      const [, index] = screen.getAllByRole('button', { name: 'Every point', hidden: true });
      fireEvent.click(index as HTMLElement);
      fireEvent.click(await screen.findByText('Approach', { selector: 'button *' }));
      await waitFor(() => expect(scrolled).toContain(shown as HTMLElement));
    } finally {
      HTMLElement.prototype.scrollIntoView = realScroll;
    }
  });

  it('steps through every stop in reading order with J and K, and keeps the place in the URL', async () => {
    const { task, state } = reviewing();
    renderReview(state, task);
    await screen.findAllByText('The loop never stops when the call keeps failing.');
    expect(screen.queryByRole('button', { name: 'Next point' })).toBeNull();
    const press = (key: string) =>
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key }));
      });
    press('j');
    await waitFor(() => expect(selectedKey()).toBe('approach'));
    expect(new URLSearchParams(location.search).get('spot')).toBe('approach');
    expect(screen.getByRole('button', { name: 'Every point' }).textContent).toBe(
      'Every pointHow it’s built·Approach'
    );
    press('j');
    press('j');
    press('j');
    await waitFor(() => expect(selectedKey()).toBe('0:1'));
    expect(screen.getByRole('button', { name: 'Every point' }).textContent).toBe(
      'Every point1 of 6·Key code·Imports the helper.'
    );
    press('k');
    await waitFor(() => expect(selectedKey()).toBe('testing'));
    expect(screen.getByRole('button', { name: 'Every point' }).textContent).toBe(
      'Every pointHow it’s built·How to test'
    );
    for (let step = 0; step < 6; step += 1) press('j');
    await waitFor(() => expect(selectedKey()).toBe('finding:0'));
    press('x');
    expect(selectedKey()).toBe('finding:0');
  });

  it('lists the steps around the merge after How to test, holds the merge and ticks a step', async () => {
    const steps = [
      {
        when: 'pre_merge' as const,
        kind: 'secret' as const,
        title: 'Set RETRY_TOKEN',
        detail: 'In production.',
        command: null,
      },
      {
        when: 'post_merge' as const,
        kind: 'migration' as const,
        title: 'Run the migration',
        detail: 'Adds the retries table.',
        command: 'bun run db:migrate',
      },
    ];
    const walkthrough = { ...(REPORT.walkthrough as NonNullable<WorkReport['walkthrough']>), steps };
    const phaseReports = [{ index: 0, summary: 'Done.', spots: [], judgementCalls: [], walkthrough, at: 0 }];
    const { task, state } = reviewing(
      { stage: 'awaiting_merge', phaseReports, report: { ...REPORT, walkthrough } },
      'merge'
    );
    renderReview(state, task);
    await screen.findAllByText('The loop never stops when the call keeps failing.');
    const items = [...document.querySelectorAll('[data-review-item]')].map((item) =>
      item.getAttribute('data-review-item')
    );
    expect(items.slice(0, 5)).toEqual(['approach', 'flow', 'testing', 'pre_merge', 'post_merge']);
    expect(screen.getByText('Pre-merge steps')).toBeDefined();
    expect(screen.getByText('Post-merge steps')).toBeDefined();
    expect(document.body.textContent).toContain('bun run db:migrate');
    expect((screen.getByRole('button', { name: 'Merge' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('checkbox', { name: 'Run the migration' }).hasAttribute('data-disabled')).toBe(
      true
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Set RETRY_TOKEN' }));
    await waitFor(() =>
      expect(listSentCommands()).toMatchObject([
        {
          type: 'merge_step.tick',
          taskId: task.id,
          key: resolveMergeStepKey(steps[0] as MergeStep),
          done: true,
        },
      ])
    );
  });

  it('shows what the tests cover and the steps to try, each target opening where it belongs', async () => {
    const testing = {
      automated: ['Unit tests cover a dropped call and a call that keeps failing.'],
      manual: [
        {
          action: 'Start the API with the flaky upstream.',
          target: { kind: 'command' as const, value: 'bun run dev:flaky' },
          expect: 'The log says `upstream: flaky`.',
        },
        {
          action: 'Open the orders page.',
          target: { kind: 'url' as const, value: 'http://localhost:5173/orders' },
          expect: 'The orders load after one retry.',
        },
        {
          action: 'Open the retry banner.',
          target: { kind: 'screen' as const, value: 'Orders → the retry banner' },
          expect: 'It counts the tries.',
        },
        {
          action: 'Read the loop.',
          target: { kind: 'file' as const, value: 'src/retry.ts:2-3' },
          expect: 'It stops after three tries.',
        },
      ],
    };
    const walkthrough = { ...(REPORT.walkthrough as NonNullable<WorkReport['walkthrough']>), testing };
    const { task, state } = reviewing({
      report: { ...REPORT, walkthrough },
      projectId: 'shop',
      worktreePath: '/tmp/worktrees/retry',
    });
    const posts: unknown[] = [];
    const served = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) !== '/api/terminals') return served(input, init);
      posts.push(JSON.parse(String(init?.body)));
      return new Response('no terminal here', { status: 500 });
    }) as typeof fetch;
    renderReview({ ...state, projects: { shop: createProject({ id: 'shop' }) } }, task);
    await screen.findAllByText('The loop never stops when the call keeps failing.');
    expect(screen.getByText('Covered by tests')).toBeDefined();
    expect(screen.getByText('Unit tests cover a dropped call and a call that keeps failing.')).toBeDefined();
    expect(screen.getByText('Building')).toBeDefined();
    expect(screen.getByText('Try it yourself')).toBeDefined();
    expect(screen.getAllByText('You should see')).toHaveLength(4);
    expect(screen.getByText('It stops after three tries.')).toBeDefined();
    const panel = document.querySelector('[data-review-item="testing"]') as HTMLElement;
    const steps = [...panel.querySelectorAll('ol > li')];
    expect(steps.map((step) => step.firstElementChild?.textContent)).toEqual(['1', '2', '3', '4']);
    const link = screen.getByRole('link', { name: 'http://localhost:5173/orders' });
    expect(link.getAttribute('href')).toBe('http://localhost:5173/orders');
    expect(link.getAttribute('target')).toBe('_blank');
    const screenTarget = screen.getByText('Orders → the retry banner');
    expect(screenTarget.closest('a')).toBeNull();
    expect(within(panel).getByText('src/retry.ts').closest('a')?.getAttribute('href')).toBe(
      resolveCodePath(task, { file: 'src/retry.ts', start: 2, end: 3 })
    );
    expect(document.body.textContent).toContain('bun run dev:flaky');
    fireEvent.click(screen.getByRole('button', { name: 'Run in terminal' }));
    await waitFor(() =>
      expect(posts).toEqual([
        { projectId: 'shop', path: '/tmp/worktrees/retry', command: 'bun run dev:flaky' },
      ])
    );
  });

  it('opens on the place a link names', async () => {
    const { task, state } = reviewing();
    renderReview(state, task, '&spot=call%3A0');
    await screen.findAllByText('Three tries');
    expect(selectedKey()).toBe('call:0');
    await waitFor(() => expect(selectedKey()).toBeNull(), { timeout: 3000 });
    expect(new URLSearchParams(location.search).get('spot')).toBe('call:0');
  });

  it('decides on each finding and sends the decision from the same action as the Overview', async () => {
    const { task, state } = reviewing();
    renderReview(state, task);
    expect(await screen.findByRole('button', { name: 'Fix 1 finding' })).toBeDefined();
    fireEvent.click(screen.getAllByRole('tab', { name: 'Fix' })[1] as HTMLElement);
    expect(await screen.findByRole('button', { name: 'Fix 2 findings' })).toBeDefined();
    fireEvent.click(screen.getAllByRole('tab', { name: 'Dismiss' })[0] as HTMLElement);
    fireEvent.click(screen.getAllByRole('tab', { name: 'Dismiss' })[1] as HTMLElement);
    fireEvent.click(await screen.findByRole('button', { name: 'Approve changes' }));
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

  it('marks the riskiest changes when the agent handed over no report, with no decision after the merge', async () => {
    const { task, state } = reviewing(
      { report: null, findings: [], reviewSummary: null, summary: 'Older hand-over.', stage: 'merged' },
      null
    );
    renderReview(state, task);
    expect(await screen.findByText('Older hand-over.')).toBeDefined();
    expect(
      screen.getByText('The agent handed over no report, so Shinsa marked the riskiest changes.')
    ).toBeDefined();
    expect(screen.getByText('The agent review has not run yet.')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Approve changes' })).toBeNull();
    expect(screen.queryByText('How to test')).toBeNull();
  });

  it('reads a report without a walkthrough as its marked points, and an agent review that found nothing', async () => {
    const { task, state } = reviewing({
      report: { ...REPORT, walkthrough: null, sections: [], judgementCalls: [], checks: [] },
      findings: [],
      checkResults: null,
    });
    renderReview(state, task);
    expect(
      await screen.findByText('The agent wrote no walkthrough, so the review is its marked points.')
    ).toBeDefined();
    expect(
      screen.getByText('No point is marked. The changed files are under Everything else.')
    ).toBeDefined();
    expect(screen.queryByText('Every point')).toBeNull();
    expect(screen.getByText('Found nothing to fix. A signal for you, never the approval.')).toBeDefined();
  });

  it('says so when the changes cannot be read, and still shows the evidence', async () => {
    globalThis.fetch = (async () => new Response('gone', { status: 500 })) as unknown as typeof fetch;
    const { task, state } = reviewing({ report: null });
    const withEvidence = {
      ...state,
      evidence: { shot: createEvidence({ id: 'shot', taskId: task.id, title: 'Settings page' }) },
    };
    renderReview(withEvidence, task);
    await waitFor(() => expect(document.body.textContent).not.toContain('Reading the changes'));
    expect(screen.getByText('Settings page')).toBeDefined();
  });
});
