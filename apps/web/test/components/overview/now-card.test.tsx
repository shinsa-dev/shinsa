import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { Gate, ShinsaState, Task, UsageWait } from '@shinsa/core';
import { Toaster, toast } from '@shinsa/ui/components/sonner';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ReviewDraftProvider } from '@/components/task/review-draft.tsx';
import { useReviewDraft } from '@/hooks/use-review-draft.ts';
import { closeSignIn, useSignInDialog } from '@/lib/connection/accounts.ts';
import { OverviewTab } from '@/routes/task/overview.tsx';
import { createSnapshot } from '../../support/accounts.ts';
import { findTooltipText } from '../../support/hover.ts';
import { startFakeOnboarding } from '../../support/onboarding.ts';
import { createPullRequest } from '../../support/pull-request.ts';
import { createRound } from '../../support/rounds.ts';
import {
  holdAcks,
  listSentCommands,
  pushState,
  releaseAcks,
  startFakeServer,
  stopFakeServer,
} from '../../support/server.ts';
import { createGate, createRun, createShinsaState, createTask } from '../../support/state.ts';

function DraftComment() {
  const draft = useReviewDraft();
  return (
    <button
      type='button'
      onClick={() => draft.addComment({ path: 'src/a.ts', line: 3, text: 'Rename this.' })}
    >
      Add a line comment
    </button>
  );
}

const HOUR = 3_600_000;

function DialogProbe() {
  const dialog = useSignInDialog();
  return <output aria-label='Sign-in dialog'>{dialog.open ? `open ${dialog.accountId}` : 'closed'}</output>;
}

function renderOverview(state: ShinsaState, task: Task, gate: Gate | undefined, onOpen = mock()) {
  pushState(state);
  const view = render(
    <TooltipProvider>
      <ReviewDraftProvider enabled draftKey={task.id}>
        <DraftComment />
        <OverviewTab state={state} task={task} gate={gate} onOpen={onOpen} />
      </ReviewDraftProvider>
      <DialogProbe />
      <Toaster />
    </TooltipProvider>
  );
  return { view, onOpen };
}

function wait(overrides: Partial<UsageWait> = {}): UsageWait {
  return {
    id: 'w',
    runId: 'r',
    role: 'agent',
    phaseIndex: 0,
    account: { id: 'a', email: 'a@example.com' },
    resetAt: Date.now() + 3 * HOUR + 60_000,
    armedAt: Date.now(),
    autoResume: true,
    status: 'armed',
    ...overrides,
  };
}

function reviewing(kind: 'review' | 'merge' = 'review') {
  const task = createTask({
    id: 'task-1',
    stage: kind === 'merge' ? 'awaiting_merge' : 'awaiting_review',
    pullRequest: kind === 'merge' ? createPullRequest({ number: 42 }) : null,
  });
  const gate = createGate({ id: 'gate-1', taskId: 'task-1', type: kind });
  return { task, gate, state: createShinsaState({ tasks: [task], gates: [gate] }) };
}

function findButton(view: ReturnType<typeof render>, label: string) {
  return view.getByText(label).closest('button') as HTMLButtonElement;
}

beforeEach(() => {
  startFakeServer();
  toast.dismiss();
});

afterEach(() => {
  stopFakeServer();
});

describe('NowCard on the Overview', () => {
  it('heads a working round in sentence case: its status, the round of all of them, the role and when it started', () => {
    const task = createTask({
      id: 'task-1',
      stage: 'building',
      rounds: [
        createRound({ number: 1, status: 'merged' }),
        createRound({ number: 2, status: 'active', endedAt: null, outcome: null }),
      ],
    });
    const run = createRun({ id: 'r', taskId: 'task-1', role: 'agent', startedAt: Date.now() });
    const { view } = renderOverview(createShinsaState({ tasks: [task], runs: [run] }), task, undefined);
    const eyebrow = view.getByText('Round 2 of 2').parentElement?.parentElement as HTMLElement;
    expect(eyebrow.textContent).toMatch(/·Round 2 of 2·.*Agent.*·Started just now$/);
    expect(eyebrow.textContent).not.toMatch(/round 2|started/);
  });

  it('names the run of the checks between phases and spins the checks it runs, so it never looks stuck', () => {
    const checks = [
      { id: 'c1', label: 'Unit tests', command: 'bun test a.test.ts', phases: [1], source: 'plan' as const },
      { id: 'c2', label: 'Types', command: 'bun run check-types', phases: [2], source: 'plan' as const },
    ];
    const task = createTask({
      id: 'task-1',
      stage: 'checking',
      stageReason: 'running the checks for phase 1 of 2',
      plan: {
        version: 1,
        body: '',
        proposedAt: 0,
        document: {
          goal: 'Ship it.',
          phases: [
            { title: 'First', detail: 'The first half.' },
            { title: 'Second', detail: 'The second half.' },
          ],
          behaviour: [],
          approach: '',
          files: [],
          outOfScope: [],
          verification: [],
          questions: [],
        },
      },
      phases: [{ status: 'done', at: 0 }],
      phaseReports: [{ index: 1, summary: '', spots: [], judgementCalls: [], at: 0 }],
      checks,
      runningChecks: ['c1'],
    });
    const { view } = renderOverview(createShinsaState({ tasks: [task] }), task, undefined);
    const card = within(view.container.querySelector('section') as HTMLElement);
    expect(card.getByText('Running the checks for phase 1 of 2')).toBeTruthy();
    expect(card.getByText('Running 1 check')).toBeTruthy();
    expect(card.getByRole('status', { name: 'Running' })).toBeTruthy();
    expect(card.queryByText('The second half.')).toBeNull();
  });

  function reviewWithCheck(outcome: 'pass' | 'fail') {
    const task = createTask({
      id: 'task-1',
      stage: 'awaiting_review',
      checks: [{ id: 'c1', label: 'Unit tests', command: 'bun test a.test.ts', phases: [1], source: 'plan' }],
      checkResults: [{ id: 'c1', label: 'Unit tests', command: 'bun test a.test.ts', outcome, detail: null }],
    });
    const gate = createGate({ id: 'gate-1', taskId: 'task-1' });
    const { view } = renderOverview(createShinsaState({ tasks: [task], gates: [gate] }), task, gate);
    return within(view.container.querySelector('section') as HTMLElement);
  }

  it('folds passing checks on the review card into one line that opens them', () => {
    const card = reviewWithCheck('pass');
    expect(card.getByText('The check passed')).toBeTruthy();
    expect(card.queryByText('bun test a.test.ts')).toBeNull();
    fireEvent.click(card.getByRole('button', { name: 'Expand the checks' }));
    expect(card.getByText('Building')).toBeTruthy();
    expect(card.getByText('bun test a.test.ts')).toBeTruthy();
  });

  it('opens the checks on the review card when one failed', () => {
    const card = reviewWithCheck('fail');
    expect(card.getByText('bun test a.test.ts')).toBeTruthy();
  });

  function waitingOnTasks(type: 'review' | 'merge') {
    const docs = createTask({ id: 'docs', title: 'Document the agent login', stage: 'building' });
    const skills = createTask({ id: 'skills', title: 'Teach the skill to log in', stage: 'merged' });
    const task = createTask({
      id: 'task-1',
      stage: type === 'merge' ? 'awaiting_merge' : 'awaiting_review',
      waitsOn: ['docs', 'skills'],
    });
    const gate = createGate({ id: 'gate-1', taskId: 'task-1', type });
    const state = createShinsaState({ tasks: [docs, skills, task], gates: [gate] });
    const { view } = renderOverview(state, task, gate);
    return within(view.container.querySelector('section') as HTMLElement);
  }

  it('keeps Pre-merge steps off the review gate, even when the merge waits on other tasks', () => {
    const card = waitingOnTasks('review');
    expect(card.queryByText('Pre-merge steps')).toBeNull();
    expect(card.queryByText('Linked task')).toBeNull();
  });

  it('lists the tasks the merge waits on at the merge gate as task links, ticked once each finishes and never by you', async () => {
    const card = waitingOnTasks('merge');
    expect(card.getByText('Pre-merge steps')).toBeTruthy();
    expect(card.getByRole('link', { name: /Document the agent login/ })).toBeTruthy();
    expect(card.getAllByText('Linked task')).toHaveLength(2);
    const boxes = card.getAllByRole('checkbox');
    expect(boxes.map((box) => box.getAttribute('aria-checked'))).toEqual(['false', 'true']);
    expect(boxes.every((box) => box.hasAttribute('data-disabled'))).toBe(true);
    fireEvent.click(boxes[0] as HTMLElement);
    expect(listSentCommands().filter((command) => command.type === 'merge_step.tick')).toEqual([]);
    expect(await findTooltipText(boxes[0]?.parentElement as HTMLElement)).toContain(
      'Ticks itself once that task finishes'
    );
  });

  it('shows no Pre-merge steps on a review gate with no steps and nothing to wait on', () => {
    const { task, gate, state } = reviewing();
    const { view } = renderOverview(state, task, gate);
    expect(view.queryByText('Pre-merge steps')).toBeNull();
  });

  it('offers Review then Approve changes on a review gate', () => {
    const { task, gate, state } = reviewing();
    const { view } = renderOverview(state, task, gate);
    const actions = view.getAllByRole('button').map((button) => button.textContent);
    expect(actions.indexOf('Review')).toBeLessThan(actions.indexOf('Approve changes'));
  });

  it('opens the code review from the Review button', () => {
    const { task, gate, state } = reviewing();
    const { view, onOpen } = renderOverview(state, task, gate);
    fireEvent.click(view.getByRole('button', { name: 'Review' }));
    expect(onOpen).toHaveBeenCalledWith('review');
  });

  it('approves the changes and says the pull request is opening', async () => {
    const { task, gate, state } = reviewing();
    const { view } = renderOverview(state, task, gate);
    fireEvent.click(view.getByRole('button', { name: 'Approve changes' }));
    await waitFor(() =>
      expect(listSentCommands()).toEqual([
        { type: 'gate.answer', gateId: 'gate-1', decision: 'approve', response: null },
      ])
    );
    expect(await view.findByText('Approved. Opening the pull request.')).toBeTruthy();
  });

  it('tells you Approve changes opens the pull request', async () => {
    const { task, gate, state } = reviewing();
    const { view } = renderOverview(state, task, gate);
    const approve = view.getByRole('button', { name: 'Approve changes' }).parentElement as HTMLElement;
    expect(await findTooltipText(approve)).toBe('Opens the pull request');
  });

  it('disables Approve changes while line comments are drafted and says why', async () => {
    const { task, gate, state } = reviewing();
    const { view } = renderOverview(state, task, gate);
    fireEvent.click(view.getByRole('button', { name: 'Add a line comment' }));
    const approve = view.getByRole('button', { name: 'Approve changes' }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    fireEvent.click(approve);
    expect(listSentCommands()).toEqual([]);
    expect(await findTooltipText(approve.parentElement as HTMLElement)).toBe(
      'Send your line comments to the agent or remove them first'
    );
  });

  it('shows a loading Approve changes until Shinsa confirms', async () => {
    const { task, gate, state } = reviewing();
    const { view } = renderOverview(state, task, gate);
    holdAcks();
    fireEvent.click(view.getByRole('button', { name: 'Approve changes' }));
    expect(findButton(view, 'Approve changes').getAttribute('aria-busy')).toBe('true');
    releaseAcks();
    await waitFor(() => expect(findButton(view, 'Approve changes').hasAttribute('aria-busy')).toBe(false));
  });

  it('toasts the reason when Shinsa refuses the approval', async () => {
    const { task, gate, state } = reviewing();
    const { view } = renderOverview(state, task, gate);
    holdAcks();
    fireEvent.click(view.getByRole('button', { name: 'Approve changes' }));
    releaseAcks({ code: 'gate_closed', message: 'This gate is already answered.' });
    expect(await view.findByText('This gate is already answered.')).toBeTruthy();
  });

  it('offers Review then Merge #N on a merge gate and merges on click', async () => {
    const { task, gate, state } = reviewing('merge');
    const { view } = renderOverview(state, task, gate);
    const actions = view.getAllByRole('button').map((button) => button.textContent);
    expect(actions.indexOf('Review')).toBeLessThan(actions.indexOf('Merge #42'));
    expect(view.queryByRole('button', { name: 'Approve changes' })).toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'Merge #42' }));
    expect(listSentCommands()).toEqual([
      { type: 'gate.answer', gateId: 'gate-1', decision: 'approve', response: null },
    ]);
    expect(await view.findByText('Approved. Merging the pull request.')).toBeTruthy();
  });

  it('shows Approve plan over the plan itself on a plan gate', async () => {
    const task = createTask({
      id: 'task-1',
      stage: 'awaiting_plan',
      plan: {
        version: 1,
        body: '',
        proposedAt: 0,
        document: {
          goal: 'Ship a login form.',
          phases: [
            { title: 'Add the fields', detail: 'Email and password.' },
            { title: 'Validate input', detail: 'With zod.' },
          ],
          behaviour: [],
          approach: '',
          files: [],
          outOfScope: [],
          verification: [],
          questions: [],
        },
      },
    });
    const gate = createGate({ id: 'gate-1', taskId: 'task-1', type: 'plan' });
    const { view, onOpen } = renderOverview(createShinsaState({ tasks: [task], gates: [gate] }), task, gate);
    const card = within(view.container.querySelector('section') as HTMLElement);
    expect(card.getByText('Ship a login form.')).toBeTruthy();
    expect(card.getByText('Add the fields')).toBeTruthy();
    expect(card.getByText('Validate input')).toBeTruthy();
    expect(card.getByRole('button', { name: 'Approve plan' })).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Open the chat' }));
    expect(onOpen).toHaveBeenCalledWith('agent');
    fireEvent.click(view.getByRole('button', { name: 'Approve plan' }));
    expect(listSentCommands()).toEqual([
      { type: 'gate.answer', gateId: 'gate-1', decision: 'approve', response: null, planVersion: 1 },
    ]);
    expect(await view.findByText('Approved. Building now.')).toBeTruthy();
  });

  it('offers only Start building on a plan kept in the backlog', async () => {
    const task = createTask({ id: 'task-1', stage: 'awaiting_plan', backlog: { at: 0 } });
    const gate = createGate({ id: 'gate-1', taskId: 'task-1', type: 'plan' });
    const { view } = renderOverview(createShinsaState({ tasks: [task], gates: [gate] }), task, gate);
    expect(view.getByText('Planned and kept in the backlog')).toBeTruthy();
    expect(view.queryByRole('button', { name: 'Approve plan' })).toBeNull();
    expect(view.queryByRole('button', { name: 'Back to Needs you' })).toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'Start building' }));
    expect(listSentCommands()).toEqual([
      { type: 'gate.answer', gateId: 'gate-1', decision: 'approve', response: null, planVersion: undefined },
    ]);
    expect(
      await view.findByText(
        'Started. The worktree moves onto the latest default branch, then building begins.'
      )
    ).toBeTruthy();
  });

  it('says the operation runs next when you approve an operation’s plan', async () => {
    const task = createTask({ id: 'task-1', stage: 'awaiting_plan', pipeline: ['plan', 'operate'] });
    const gate = createGate({ id: 'gate-1', taskId: 'task-1', type: 'plan' });
    const { view } = renderOverview(createShinsaState({ tasks: [task], gates: [gate] }), task, gate);
    fireEvent.click(view.getByRole('button', { name: 'Approve plan' }));
    expect(await view.findByText('Approved. Running the operation now.')).toBeTruthy();
    expect(view.queryByText('Approved. Building now.')).toBeNull();
  });

  it('shows the plan’s evidence, checks and impact under its phases, and that it asked for your approval', () => {
    const task = createTask({
      id: 'task-1',
      stage: 'awaiting_plan',
      plan: {
        version: 1,
        body: '',
        proposedAt: 0,
        document: {
          goal: 'Backfill currencies.',
          phases: [{ title: 'Add the script', detail: 'With a dry run.' }],
          behaviour: [],
          approach: '',
          files: [],
          outOfScope: [],
          verification: [
            { label: 'Currency tests', command: 'bun test currency', phases: [1] },
            { label: 'Backfill dry run', command: 'bun scripts/backfill.ts --dry-run', phases: [1] },
          ],
          questions: [],
          impact: 'About 12,400 products.',
          evidence: ['screenshot', 'recording'],
          approval: true,
        },
      },
    });
    const gate = createGate({ id: 'gate-1', taskId: 'task-1', type: 'plan' });
    const { view } = renderOverview(createShinsaState({ tasks: [task], gates: [gate] }), task, gate);
    const card = within(view.container.querySelector('section') as HTMLElement);
    expect(card.getByText('Impact')).toBeTruthy();
    expect(card.getByText('About 12,400 products.')).toBeTruthy();
    expect(card.getByText('Evidence')).toBeTruthy();
    expect(card.getByText('Screenshot · Recording')).toBeTruthy();
    expect(card.getByText('Checks')).toBeTruthy();
    expect(card.getByText('Backfill dry run')).toBeTruthy();
    expect(card.getByText('bun scripts/backfill.ts --dry-run')).toBeTruthy();
    expect(card.getByText('The agent asked for your approval.')).toBeTruthy();
  });

  it('offers Retry and Cancel task on a paused task', async () => {
    const task = createTask({ id: 'task-1' });
    const gate = createGate({
      id: 'gate-1',
      taskId: 'task-1',
      type: 'failure',
      title: 'Out of automatic fix rounds',
      body: 'The checks kept failing.',
    });
    const { view } = renderOverview(createShinsaState({ tasks: [task], gates: [gate] }), task, gate);
    expect(view.getByText('Out of automatic fix rounds')).toBeTruthy();
    expect(view.getByText('The checks kept failing.')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Retry' }));
    const cancel = view.getByRole('button', { name: 'Cancel task' }) as HTMLButtonElement;
    await waitFor(() => expect(cancel.disabled).toBe(false));
    fireEvent.click(cancel);
    expect(listSentCommands()).toEqual([
      { type: 'gate.answer', gateId: 'gate-1', decision: 'approve', response: null },
      { type: 'gate.answer', gateId: 'gate-1', decision: 'reject', response: null },
    ]);
  });

  it('links a paused task to the run that stopped', () => {
    const task = createTask({ id: 'task-1' });
    const run = createRun({
      id: 'run-1',
      taskId: 'task-1',
      endedAt: 1,
      outcome: 'failed',
      summary: 'Tests broke.',
    });
    const gate = createGate({ id: 'gate-1', taskId: 'task-1', type: 'failure', runId: 'run-1' });
    const { view, onOpen } = renderOverview(
      createShinsaState({ tasks: [task], gates: [gate], runs: [run] }),
      task,
      gate
    );
    expect(view.getByText('Tests broke.')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: /Open in chat/ }));
    expect(onOpen).toHaveBeenCalledWith('agent', 'run-1');
  });

  it('sends your answer to a question when you press Enter', async () => {
    const task = createTask({ id: 'task-1' });
    const gate = createGate({
      id: 'gate-1',
      taskId: 'task-1',
      type: 'question',
      title: 'Which colour?',
    });
    const { view } = renderOverview(createShinsaState({ tasks: [task], gates: [gate] }), task, gate);
    const field = view.getByRole('textbox', { name: 'Your answer' });
    fireEvent.keyDown(field, { key: 'Enter' });
    fireEvent.change(field, { target: { value: '  Blue  ' } });
    fireEvent.keyDown(field, { key: 'Enter', shiftKey: true });
    expect(listSentCommands()).toEqual([]);
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(listSentCommands()).toEqual([
      { type: 'gate.answer', gateId: 'gate-1', decision: 'reply', response: 'Blue' },
    ]);
    expect(await view.findByText('Answered. The agent carries on.')).toBeTruthy();
  });

  it('sends your answer to a question when you click Send answer', async () => {
    const task = createTask({ id: 'task-1' });
    const gate = createGate({
      id: 'gate-1',
      taskId: 'task-1',
      type: 'question',
      title: 'Which colour?',
    });
    const { view } = renderOverview(createShinsaState({ tasks: [task], gates: [gate] }), task, gate);
    const answer = view.getByRole('button', { name: 'Send answer' }) as HTMLButtonElement;
    expect(answer.disabled).toBe(true);
    fireEvent.change(view.getByRole('textbox', { name: 'Your answer' }), { target: { value: 'Green' } });
    holdAcks();
    fireEvent.click(answer);
    expect(findButton(view, 'Send answer').getAttribute('aria-busy')).toBe('true');
    releaseAcks();
    await waitFor(() => expect(findButton(view, 'Send answer').hasAttribute('aria-busy')).toBe(false));
    expect(listSentCommands()).toEqual([
      { type: 'gate.answer', gateId: 'gate-1', decision: 'reply', response: 'Green' },
    ]);
  });

  function createRevisedPlan(revision: { changeSummary?: string; feedback?: string }) {
    return createTask({
      id: 'task-1',
      stage: 'awaiting_plan',
      plan: {
        version: 2,
        body: '',
        proposedAt: 0,
        changes: [
          { kind: 'goal' },
          { kind: 'phase_added', title: 'Validate input' },
          { kind: 'phase_changed', title: 'Show errors' },
          { kind: 'phase_removed', title: 'Style the form' },
        ],
        ...revision,
        document: {
          goal: 'Ship a login form.',
          phases: [
            { title: 'Build the form', detail: 'Two fields.' },
            { title: 'Validate input', detail: 'With zod.' },
            { title: 'Show errors', detail: 'Under each field.' },
          ],
          behaviour: [],
          approach: '',
          files: [],
          outOfScope: [],
          verification: [],
          questions: [],
        },
      },
    });
  }

  it('names a revised plan’s version, keeps your words apart and marks the new and reworked phases', () => {
    const task = createRevisedPlan({
      changeSummary: 'Split validation into its own phase.',
      feedback: 'Validate on the server too.',
    });
    const gate = createGate({ id: 'gate-1', taskId: 'task-1', type: 'plan', planVersion: 2 });
    const { view } = renderOverview(createShinsaState({ tasks: [task], gates: [gate] }), task, gate);
    expect(view.getByText(/Version 2 · 3 phases/)).toBeTruthy();
    const asked = view.getByText('You asked').parentElement;
    expect(asked?.textContent).toBe('You askedValidate on the server too.');
    const summary = view.getByText('What changed').parentElement;
    expect(summary?.textContent).toBe('What changedSplit validation into its own phase.');
    expect(summary?.nextElementSibling?.textContent).toBe('Ship a login form.');
    expect(view.getByText('Validate input').parentElement?.textContent).toBe('Validate inputNew');
    expect(view.getByText('Show errors').parentElement?.textContent).toBe('Show errorsChanged');
    expect(view.getByText('Build the form').parentElement?.textContent).toBe('Build the form');
    expect(view.queryByText(/Style the form|Changed the goal|Added the phase/)).toBeNull();
  });

  it('shows neither your words nor what changed when a revision has none', () => {
    const task = createRevisedPlan({});
    const gate = createGate({ id: 'gate-1', taskId: 'task-1', type: 'plan', planVersion: 2 });
    const { view } = renderOverview(createShinsaState({ tasks: [task], gates: [gate] }), task, gate);
    expect(view.queryByText('You asked')).toBeNull();
    expect(view.queryByText('What changed')).toBeNull();
    expect(view.getByText('New')).toBeTruthy();
  });

  it('answers a question with one of its choices in one click', async () => {
    const task = createTask({ id: 'task-1' });
    const gate = createGate({
      id: 'gate-1',
      taskId: 'task-1',
      type: 'question',
      title: 'Which colour?',
      choices: ['Blue', 'Green'],
      recommendation: 'Green',
    });
    const { view } = renderOverview(createShinsaState({ tasks: [task], gates: [gate] }), task, gate);
    expect(view.getByText('Recommended')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: /Green/ }));
    expect(listSentCommands()).toEqual([
      { type: 'gate.answer', gateId: 'gate-1', decision: 'reply', response: 'Green' },
    ]);
    expect(await view.findByText('Answered. The agent carries on.')).toBeTruthy();
  });

  it('lets you decide each review finding: kept ones go to the agent, dismissing all approves', async () => {
    const { gate } = reviewing();
    const task = createTask({
      id: 'task-1',
      stage: 'awaiting_review',
      findings: [
        { severity: 'blocking', file: 'src/a.ts', line: 3, message: 'Off by one.' },
        { severity: 'optional', file: null, line: null, message: 'Rename it.' },
      ],
    });
    const escalated = { ...gate, escalation: { reason: 'rounds' as const, rounds: 2, at: 1 } };
    const { view } = renderOverview(
      createShinsaState({ tasks: [task], gates: [escalated] }),
      task,
      escalated
    );
    expect(view.getByText('The agents could not settle the review')).toBeTruthy();
    expect(view.getByText(/after 2 fix rounds/)).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Fix 1 finding' }));
    await waitFor(() => expect(findButton(view, 'Fix 1 finding').hasAttribute('aria-busy')).toBe(false));
    fireEvent.click(view.getAllByRole('tab', { name: 'Dismiss' })[0] as HTMLElement);
    const approve = view.getByRole('button', { name: 'Approve changes' }) as HTMLButtonElement;
    await waitFor(() => expect(approve.disabled).toBe(false));
    fireEvent.click(approve);
    expect(listSentCommands()).toEqual([
      {
        type: 'gate.answer',
        gateId: 'gate-1',
        decision: 'revise',
        response: null,
        verdicts: [
          { index: 0, verdict: 'fix', note: null },
          { index: 1, verdict: 'dismiss', note: null },
        ],
      },
      {
        type: 'gate.answer',
        gateId: 'gate-1',
        decision: 'approve',
        response: null,
        verdicts: [
          { index: 0, verdict: 'dismiss', note: null },
          { index: 1, verdict: 'dismiss', note: null },
        ],
      },
    ]);
  });

  it('Fix 1 finding also sends your drafted line comments, then clears them', async () => {
    const { gate } = reviewing();
    const task = createTask({
      id: 'task-1',
      stage: 'awaiting_review',
      findings: [{ severity: 'blocking', file: 'src/a.ts', line: 3, message: 'Off by one.' }],
    });
    const escalated = { ...gate, escalation: { reason: 'rounds' as const, rounds: 2, at: 1 } };
    const { view } = renderOverview(
      createShinsaState({ tasks: [task], gates: [escalated] }),
      task,
      escalated
    );
    fireEvent.click(view.getByRole('button', { name: 'Add a line comment' }));
    const fix = view.getByRole('button', { name: 'Fix 1 finding' }) as HTMLButtonElement;
    expect(fix.disabled).toBe(false);
    expect(await findTooltipText(fix.parentElement as HTMLElement)).toBe(
      'Sends the findings you kept and your line comments to the agent'
    );
    fireEvent.click(fix);
    await waitFor(() => expect(listSentCommands()).toHaveLength(1));
    expect(listSentCommands()).toEqual([
      {
        type: 'gate.answer',
        gateId: 'gate-1',
        decision: 'revise',
        response: null,
        verdicts: [{ index: 0, verdict: 'fix', note: null }],
        comments: [{ path: 'src/a.ts', side: 'new', line: 3, endLine: null, text: 'Rename this.' }],
      },
    ]);
    await waitFor(() => expect(findButton(view, 'Fix 1 finding').hasAttribute('aria-busy')).toBe(false));
    fireEvent.click(view.getAllByRole('tab', { name: 'Dismiss' })[0] as HTMLElement);
    expect((view.getByRole('button', { name: 'Approve changes' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows what the setup is missing, verifies it again or cancels, and never offers to skip checks', async () => {
    const task = createTask({
      id: 'task-1',
      stage: 'triage',
      configProblems: [{ kind: 'default_branch', detail: 'The repository has no default branch.' }],
    });
    const gate = createGate({
      id: 'gate-1',
      taskId: 'task-1',
      type: 'configuration',
      title: 'The default branch is missing',
      body: 'Shinsa stopped before any agent started because the setup is not complete:\n- The repository has no default branch.',
    });
    const { view } = renderOverview(createShinsaState({ tasks: [task], gates: [gate] }), task, gate);
    expect(view.getByText('The default branch is missing')).toBeTruthy();
    expect(view.getByText('The repository has no default branch.')).toBeTruthy();
    expect(view.queryByRole('button', { name: 'Start without checks' })).toBeNull();
    const verify = view.getByRole('button', { name: 'Verify again' }) as HTMLButtonElement;
    fireEvent.click(verify);
    await waitFor(() => expect(verify.hasAttribute('aria-busy')).toBe(false));
    const cancel = view.getByRole('button', { name: 'Cancel task' }) as HTMLButtonElement;
    await waitFor(() => expect(cancel.disabled).toBe(false));
    fireEvent.click(cancel);
    expect(listSentCommands().map((command) => (command as { decision: string }).decision)).toEqual([
      'approve',
      'reject',
    ]);
  });

  it('keeps a card’s quiet links from firing twice while its action is on its way', async () => {
    const task = createTask({ id: 'task-1' });
    const failure = createGate({
      id: 'gate-1',
      taskId: 'task-1',
      type: 'failure',
      title: 'Out of fix rounds',
    });
    const { view } = renderOverview(createShinsaState({ tasks: [task], gates: [failure] }), task, failure);
    holdAcks();
    fireEvent.click(view.getByRole('button', { name: 'Retry' }));
    const cancel = view.getByRole('button', { name: 'Cancel task' }) as HTMLButtonElement;
    expect(cancel.disabled).toBe(true);
    releaseAcks();
    await waitFor(() => expect(cancel.disabled).toBe(false));
  });

  it('offers to allow more on a task that reached its usage or cost limit', () => {
    const spent = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 6 };
    const task = createTask({ id: 'task-1' });
    const gate = createGate({ id: 'gate-1', taskId: 'task-1', type: 'failure', cause: 'budget' });
    const run = createRun({
      id: 'run-1',
      taskId: 'task-1',
      usage: spent,
      meters: [
        {
          attemptId: 'attempt-1',
          window: 'account:work',
          from: 0,
          to: 100,
          usage: spent,
          readings: [
            { percent: 40, at: 0, resetsAt: null },
            { percent: 52, at: 100, resetsAt: null },
          ],
        },
      ],
    });
    const history = Array.from({ length: 4 }, (_, index) => {
      const cost = { ...spent, costUsd: 1 };
      const from = 1_000 + index * 1_000;
      return createRun({
        id: `history-${index}`,
        taskId: `history-${index}`,
        usage: cost,
        meters: [
          {
            attemptId: `history-${index}`,
            window: 'account:work',
            from,
            to: from + 100,
            usage: cost,
            readings: [
              { percent: 52 + index * 2, at: from, resetsAt: null },
              { percent: 54 + index * 2, at: from + 100, resetsAt: null },
            ],
          },
        ],
      });
    });
    const state = createShinsaState({ tasks: [task], gates: [gate], runs: [run, ...history] });
    state.settings.taskBudgetUsd = 5;
    const { view } = renderOverview(state, task, gate);
    expect(view.getByRole('button', { name: 'Allow another $5.00' })).toBeTruthy();
    view.unmount();
    state.settings.taskUsageLimit = 10;
    const usage = renderOverview(state, task, gate);
    expect(usage.view.getByRole('button', { name: 'Allow another 10%' })).toBeTruthy();
  });

  it('shows a waiting agent’s notes and checks in now on request', async () => {
    const now = Date.now();
    const task = createTask({
      id: 'task-1',
      monitor: {
        id: 'm',
        runId: 'r',
        role: 'agent',
        phaseIndex: 0,
        notes: 'The staging deploy.',
        armedAt: now,
        nextCheckAt: now + 12 * 60_000,
        timeoutAt: now + 120 * 60_000,
        attempts: 1,
        maxAttempts: 10,
        status: 'armed',
      },
    });
    const { view } = renderOverview(createShinsaState({ tasks: [task] }), task, undefined);
    expect(view.getByText('The agent is waiting on something outside the repository')).toBeTruthy();
    expect(view.getByText('The staging deploy.')).toBeTruthy();
    expect(view.getByText(/Check-in 2 of 10/)).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Check in now' }));
    await waitFor(() =>
      expect(listSentCommands()).toEqual([{ type: 'monitor.check_in_now', taskId: 'task-1' }])
    );
  });

  it('flags a run that went quiet, and snoozes or dismisses the flag', async () => {
    const task = createTask({ id: 'task-1' });
    const run = createRun({
      id: 'run-1',
      taskId: 'task-1',
      status: 'running',
      silence: { since: Date.now() - 20 * 60_000, snoozedUntil: null, dismissed: false },
    });
    const { view } = renderOverview(createShinsaState({ tasks: [task], runs: [run] }), task, undefined);
    expect(view.getByText('No output for 20 minutes')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Snooze' }));
    const dismiss = view.getByRole('button', { name: 'Dismiss' }) as HTMLButtonElement;
    await waitFor(() => expect(dismiss.disabled).toBe(false));
    fireEvent.click(dismiss);
    await waitFor(() =>
      expect(listSentCommands().map((command) => command.type)).toEqual([
        'run.snooze_silence',
        'run.dismiss_silence',
      ])
    );
  });

  it('names the task up the chain that holds this one up', () => {
    const blocker = createTask({ id: 'blocker', title: 'Fix the schema', stage: 'awaiting_review' });
    const task = createTask({ id: 'task-1', stage: 'waiting_on_tasks', waitsOn: ['blocker'] });
    const gate = createGate({ id: 'gate-b', taskId: 'blocker', type: 'review' });
    const { view } = renderOverview(
      createShinsaState({ tasks: [task, blocker], gates: [gate] }),
      task,
      undefined
    );
    expect(view.getByText(/Held up because/)).toBeTruthy();
    expect(view.getByText(/is waiting on you/)).toBeTruthy();
  });

  it('shows the answer to a question, and adds or dismisses a suggested task', async () => {
    const task = createTask({
      id: 'task-1',
      stage: 'done',
      mode: 'ask',
      pipeline: ['answer'],
      result: { step: 'answer', body: 'It retries **three** times.', runId: null, at: 1 },
      suggestions: [
        {
          id: 's',
          runId: null,
          title: 'Cache the export',
          request: 'Cache it.',
          why: 'It is slow.',
          waitsOnThis: true,
          status: 'open',
          createdTaskId: null,
          suggestedAt: 1,
        },
      ],
    });
    const { view } = renderOverview(createShinsaState({ tasks: [task] }), task, undefined);
    expect(view.getByText('Answered your question')).toBeTruthy();
    expect(view.queryByRole('heading', { name: 'Answer' })).toBeNull();
    expect(view.getAllByText('three')).toHaveLength(1);
    expect(
      view.getByText('Ask a follow-up in the chat and the agent answers in the same conversation.')
    ).toBeTruthy();
    expect(view.queryByText('Summary')).toBeNull();
    expect(view.getByRole('combobox', { name: 'When to start' }).textContent).toBe('After this task merges');
    fireEvent.click(view.getByRole('button', { name: 'Add' }));
    const dismiss = view.getByRole('button', { name: 'Dismiss' }) as HTMLButtonElement;
    await waitFor(() => expect(dismiss.disabled).toBe(false));
    fireEvent.click(dismiss);
    await waitFor(() =>
      expect(listSentCommands()).toEqual([
        { type: 'suggestion.accept', taskId: 'task-1', suggestionId: 's', waitsOnThis: true },
        { type: 'suggestion.dismiss', taskId: 'task-1', suggestionId: 's' },
      ])
    );
  });
});

describe('NowCard about an account', () => {
  let fake: ReturnType<typeof startFakeOnboarding>;

  beforeEach(() => {
    fake = startFakeOnboarding({ 'POST /api/accounts/login': { answer: createSnapshot() } });
  });

  afterEach(() => {
    act(() => closeSignIn());
    fake.stop();
  });

  function renderCard(task: Task, gate?: Gate) {
    return renderOverview(createShinsaState({ tasks: [task], gates: gate ? [gate] : [] }), task, gate);
  }

  describe('the sign-in card', () => {
    const gate = createGate({
      id: 'g',
      taskId: 't',
      type: 'sign_in',
      title: 'Paused: a@example.com needs signing in',
      body: 'Claude says the login expired. Sign in again and the step starts again by itself.',
      account: { id: 'a', email: 'a@example.com' },
    });

    it('says what happened and opens the sign-in for that account', async () => {
      renderCard(createTask({ id: 't' }), gate);
      expect(screen.getByText('Sign in needed')).toBeTruthy();
      expect(
        screen.getByText((_, element) => element?.textContent === 'Paused: a@example.com needs signing in')
      ).toBeTruthy();
      expect(screen.getByText(/the login expired/)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
      await waitFor(() =>
        expect(screen.getByRole('status', { name: 'Sign-in dialog' }).textContent).toBe('open a')
      );
    });

    it('retries anyway or cancels the task', async () => {
      renderCard(createTask({ id: 't' }), gate);
      fireEvent.click(screen.getByRole('button', { name: 'Retry anyway' }));
      const cancel = screen.getByRole('button', { name: 'Cancel task' }) as HTMLButtonElement;
      await waitFor(() => expect(cancel.disabled).toBe(false));
      fireEvent.click(cancel);
      await waitFor(() =>
        expect(listSentCommands()).toEqual([
          { type: 'gate.answer', gateId: 'g', decision: 'approve', response: null },
          { type: 'gate.answer', gateId: 'g', decision: 'reject', response: null },
        ])
      );
    });

    it('signs in a new account when the gate names none', async () => {
      renderCard(createTask({ id: 't' }), { ...gate, account: null });
      fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
      await waitFor(() =>
        expect(screen.getByRole('status', { name: 'Sign-in dialog' }).textContent).toBe('open null')
      );
    });
  });

  describe('the usage wait card', () => {
    it('says the task resumes at the reset, and resumes now or stops resuming by itself', async () => {
      renderCard(createTask({ id: 't', usageWait: wait() }));
      expect(screen.getByText('Waiting for the usage limit')).toBeTruthy();
      expect(screen.getByText(/^Waiting for usage: continues at .+ on$/).textContent).toMatch(
        / on a@example\.com$/
      );
      expect(screen.getByText('Resets in 3h')).toBeTruthy();
      expect(screen.getByText('The agent stopped at the Claude usage limit on a@example.com.')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Resume now' }));
      const stop = screen.getByRole('button', { name: 'Don’t resume automatically' }) as HTMLButtonElement;
      await waitFor(() => expect(stop.disabled).toBe(false));
      fireEvent.click(stop);
      await waitFor(() =>
        expect(listSentCommands()).toEqual([
          { type: 'usage_wait.resume_now', taskId: 't' },
          { type: 'usage_wait.change', taskId: 't', autoResume: false },
        ])
      );
    });

    it('says the task is paused until the reset, and resumes at it on request', async () => {
      renderCard(createTask({ id: 't', usageWait: wait({ autoResume: false }) }));
      expect(screen.getByText(/^Waiting for usage: pauses for you at /)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Resume at the reset' }));
      await waitFor(() =>
        expect(listSentCommands()).toEqual([{ type: 'usage_wait.change', taskId: 't', autoResume: true }])
      );
    });

    it('shows the work again once the wait has resumed', () => {
      renderCard(createTask({ id: 't', usageWait: wait({ status: 'resumed' }) }));
      expect(screen.queryByText(/^Waiting for usage/)).toBeNull();
    });
  });
});
