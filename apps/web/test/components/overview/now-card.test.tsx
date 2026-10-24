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
    role: 'builder',
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
  const gate = createGate({ id: 'gate-1', taskId: 'task-1', kind });
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
    expect(await view.findByText('Merging.')).toBeTruthy();
  });

  it('shows Approve plan over the plan itself on a plan gate', async () => {
    const task = createTask({
      id: 'task-1',
      stage: 'awaiting_plan',
      spec: {
        version: 1,
        body: '',
        proposedAt: 0,
        document: {
          goal: 'Ship a login form.',
          plan: [
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
    const gate = createGate({ id: 'gate-1', taskId: 'task-1', kind: 'spec' });
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

  it('says the operation runs next when you approve an operation’s plan', async () => {
    const task = createTask({ id: 'task-1', stage: 'awaiting_plan', pipeline: ['plan', 'operate'] });
    const gate = createGate({ id: 'gate-1', taskId: 'task-1', kind: 'spec' });
    const { view } = renderOverview(createShinsaState({ tasks: [task], gates: [gate] }), task, gate);
    fireEvent.click(view.getByRole('button', { name: 'Approve plan' }));
    expect(await view.findByText('Approved. Running the operation now.')).toBeTruthy();
    expect(view.queryByText('Approved. Building now.')).toBeNull();
  });

  it('shows the plan’s evidence, extra checks and impact under its phases, and that it asked for your approval', () => {
    const task = createTask({
      id: 'task-1',
      stage: 'awaiting_plan',
      spec: {
        version: 1,
        body: '',
        proposedAt: 0,
        document: {
          goal: 'Backfill currencies.',
          plan: [{ title: 'Add the script', detail: 'With a dry run.' }],
          behaviour: [],
          approach: '',
          files: [],
          outOfScope: [],
          verification: ['A test for a product without a currency'],
          questions: [],
          impact: 'About 12,400 products.',
          evidence: ['screenshot', 'recording'],
          checks: ['bun test currency', 'bun scripts/backfill.ts --dry-run'],
          approval: true,
        },
      },
    });
    const gate = createGate({ id: 'gate-1', taskId: 'task-1', kind: 'spec' });
    const { view } = renderOverview(createShinsaState({ tasks: [task], gates: [gate] }), task, gate);
    const card = within(view.container.querySelector('section') as HTMLElement);
    expect(card.getByText('Impact')).toBeTruthy();
    expect(card.getByText('About 12,400 products.')).toBeTruthy();
    expect(card.getByText('Evidence')).toBeTruthy();
    expect(card.getByText('Screenshot · Recording')).toBeTruthy();
    expect(card.getByText('Extra checks')).toBeTruthy();
    expect(card.getByText('bun scripts/backfill.ts --dry-run')).toBeTruthy();
    expect(card.getByText('The planner asked for your approval.')).toBeTruthy();
  });

  it('offers Retry and Cancel task on a paused task', async () => {
    const task = createTask({ id: 'task-1' });
    const gate = createGate({
      id: 'gate-1',
      taskId: 'task-1',
      purpose: 'failure',
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
    const gate = createGate({ id: 'gate-1', taskId: 'task-1', purpose: 'failure', runId: 'run-1' });
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
      kind: 'question',
      purpose: 'agent_question',
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
      { type: 'gate.answer', gateId: 'gate-1', decision: 'answer', response: 'Blue' },
    ]);
    expect(await view.findByText('Answered. The agent carries on.')).toBeTruthy();
  });

  it('sends your answer to a question when you click Send answer', async () => {
    const task = createTask({ id: 'task-1' });
    const gate = createGate({
      id: 'gate-1',
      taskId: 'task-1',
      kind: 'question',
      purpose: 'agent_question',
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
      { type: 'gate.answer', gateId: 'gate-1', decision: 'answer', response: 'Green' },
    ]);
  });

  it('names a revised plan’s version, what changed since the last one and what you asked for', () => {
    const task = createTask({
      id: 'task-1',
      stage: 'awaiting_plan',
      spec: {
        version: 2,
        body: '',
        proposedAt: 0,
        changeSummary: 'Split validation into its own phase.',
        changes: [{ kind: 'phase_added', title: 'Validate input' }],
        feedback: 'Validate on the server too.',
        document: {
          goal: 'Ship a login form.',
          plan: [{ title: 'Validate input', detail: 'With zod.' }],
          behaviour: [],
          approach: '',
          files: [],
          outOfScope: [],
          verification: [],
          questions: [],
        },
      },
    });
    const gate = createGate({ id: 'gate-1', taskId: 'task-1', kind: 'spec', planVersion: 2 });
    const { view } = renderOverview(createShinsaState({ tasks: [task], gates: [gate] }), task, gate);
    expect(view.getByText(/Version 2 · 1 phase/)).toBeTruthy();
    expect(view.getByText('What changed')).toBeTruthy();
    expect(view.getByText('Split validation into its own phase.')).toBeTruthy();
    expect(view.getByText('Added the phase “Validate input”')).toBeTruthy();
    expect(view.getByText('Validate on the server too.')).toBeTruthy();
  });

  it('answers a question with one of its choices in one click', async () => {
    const task = createTask({ id: 'task-1' });
    const gate = createGate({
      id: 'gate-1',
      taskId: 'task-1',
      kind: 'question',
      purpose: 'agent_question',
      title: 'Which colour?',
      choices: ['Blue', 'Green'],
      recommendation: 'Green',
    });
    const { view } = renderOverview(createShinsaState({ tasks: [task], gates: [gate] }), task, gate);
    expect(view.getByText('Recommended')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: /Green/ }));
    expect(listSentCommands()).toEqual([
      { type: 'gate.answer', gateId: 'gate-1', decision: 'answer', response: 'Green' },
    ]);
    expect(await view.findByText('Answered. The agent carries on.')).toBeTruthy();
  });

  it('lets you decide each review finding: kept ones go to the fixer, dismissing all approves', async () => {
    const { gate } = reviewing();
    const task = createTask({
      id: 'task-1',
      stage: 'awaiting_review',
      findings: [
        { severity: 'blocking', file: 'src/a.ts', line: 3, message: 'Off by one.' },
        { severity: 'suggestion', file: null, line: null, message: 'Rename it.' },
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

  it('shows what the setup is missing, checks again, starts without checks or cancels', async () => {
    const task = createTask({
      id: 'task-1',
      stage: 'triage',
      configProblems: [{ kind: 'check_commands', detail: 'No check commands are set.' }],
    });
    const gate = createGate({
      id: 'gate-1',
      taskId: 'task-1',
      kind: 'question',
      purpose: 'configuration',
      title: 'No checks to run',
      body: 'Shinsa stopped before any agent started because the setup is not complete:\n- No check commands are set.',
    });
    const { view } = renderOverview(createShinsaState({ tasks: [task], gates: [gate] }), task, gate);
    expect(view.getByText('No checks to run')).toBeTruthy();
    expect(view.getByText('No check commands are set.')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Check again' }));
    const start = view.getByRole('button', { name: 'Start without checks' }) as HTMLButtonElement;
    await waitFor(() => expect(start.disabled).toBe(false));
    fireEvent.click(start);
    const cancel = view.getByRole('button', { name: 'Cancel task' }) as HTMLButtonElement;
    await waitFor(() => expect(cancel.disabled).toBe(false));
    fireEvent.click(cancel);
    expect(listSentCommands().map((command) => (command as { decision: string }).decision)).toEqual([
      'approve',
      'answer',
      'reject',
    ]);
  });

  it('keeps a card’s quiet links from firing twice while its action is on its way', async () => {
    const task = createTask({ id: 'task-1' });
    const failure = createGate({
      id: 'gate-1',
      taskId: 'task-1',
      purpose: 'failure',
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
    const task = createTask({ id: 'task-1' });
    const gate = createGate({ id: 'gate-1', taskId: 'task-1', purpose: 'failure', cause: 'budget' });
    const run = createRun({
      id: 'run-1',
      taskId: 'task-1',
      usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 6 },
      weeklyPercent: 12,
    });
    const state = createShinsaState({ tasks: [task], gates: [gate], runs: [run] });
    state.settings.taskBudgetUsd = 5;
    const { view } = renderOverview(state, task, gate);
    expect(view.getByRole('button', { name: 'Allow another $5.00' })).toBeTruthy();
    view.unmount();
    state.settings.taskUsageLimit = 10;
    const usage = renderOverview(state, task, gate);
    expect(usage.view.getByRole('button', { name: 'Allow another 10%' })).toBeTruthy();
  });

  it('shows a waiting agent’s notes and checks now on request', async () => {
    const now = Date.now();
    const task = createTask({
      id: 'task-1',
      monitor: {
        id: 'm',
        runId: 'r',
        role: 'builder',
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
    expect(view.getByText(/Check 2 of 10/)).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Check now' }));
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
    const task = createTask({ id: 'task-1', stage: 'queued', waitsOn: ['blocker'] });
    const gate = createGate({ id: 'gate-b', taskId: 'blocker', kind: 'review' });
    const { view } = renderOverview(
      createShinsaState({ tasks: [task, blocker], gates: [gate] }),
      task,
      undefined
    );
    expect(view.getByText(/Held up because/)).toBeTruthy();
    expect(view.getByText(/is waiting on you/)).toBeTruthy();
  });

  it('shows the answer to a question, and adds or dismisses a suggested follow-up', async () => {
    const task = createTask({
      id: 'task-1',
      stage: 'done',
      mode: 'ask',
      answer: 'It retries **three** times.',
      suggestions: [
        {
          id: 's',
          runId: null,
          title: 'Cache the export',
          intent: 'Cache it.',
          why: 'It is slow.',
          waitsOnThis: true,
          status: 'open',
          createdTaskId: null,
          suggestedAt: 1,
        },
      ],
    });
    const { view } = renderOverview(createShinsaState({ tasks: [task] }), task, undefined);
    expect(view.getByRole('heading', { name: 'Answer' })).toBeTruthy();
    expect(view.getByText('three')).toBeTruthy();
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
      kind: 'question',
      purpose: 'sign_in',
      title: 'Sign in to Claude as a@example.com',
      body: 'Claude says the login expired. Sign in again and the step starts again by itself.',
      account: { id: 'a', email: 'a@example.com' },
    });

    it('says what happened and opens the sign-in for that account', async () => {
      renderCard(createTask({ id: 't' }), gate);
      expect(screen.getByText('Sign in needed')).toBeTruthy();
      expect(
        screen.getByText((_, element) => element?.textContent === 'Sign in to Claude as a@example.com')
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
      expect(screen.getByText('Resumes when the usage limit resets')).toBeTruthy();
      expect(screen.getByText('Resets in 3h')).toBeTruthy();
      expect(screen.getByText(/on a@example.com/)).toBeTruthy();
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
      expect(screen.getByText('Paused until the usage limit resets')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Resume at the reset' }));
      await waitFor(() =>
        expect(listSentCommands()).toEqual([{ type: 'usage_wait.change', taskId: 't', autoResume: true }])
      );
    });

    it('shows the work again once the wait has resumed', () => {
      renderCard(createTask({ id: 't', usageWait: wait({ status: 'resumed' }) }));
      expect(screen.queryByText('Resumes when the usage limit resets')).toBeNull();
    });
  });
});
