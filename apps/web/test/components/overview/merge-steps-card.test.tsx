import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import {
  type MergeStep,
  type PhaseReport,
  resolveMergeStepKey,
  type ShinsaState,
  type Task,
} from '@shinsa/core';
import { Toaster, toast } from '@shinsa/ui/components/sonner';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PostMergeCard } from '@/components/overview/merge-steps-card.tsx';
import { ReviewDraftProvider } from '@/components/task/review-draft.tsx';
import { CommandRunnerProvider } from '@/components/text/code-block.tsx';
import { OverviewTab } from '@/routes/task/overview.tsx';
import { findTooltipText } from '../../support/hover.ts';
import { createPullRequest } from '../../support/pull-request.ts';
import { listSentCommands, pushState, startFakeServer, stopFakeServer } from '../../support/server.ts';
import { createGate, createRun, createShinsaState, createTask } from '../../support/state.ts';

const SECRET: MergeStep = {
  when: 'pre_merge',
  kind: 'secret',
  title: 'Set STRIPE_WEBHOOK_SECRET',
  detail: 'In the API service, from the Stripe dashboard.',
  command: null,
};

const MIGRATION: MergeStep = {
  when: 'post_merge',
  kind: 'migration',
  title: 'Run the migration',
  detail: 'Adds the invoices table.',
  command: 'bun run db:migrate',
};

function reportWith(steps: MergeStep[]): PhaseReport[] {
  const walkthrough = { approach: 'a', flow: 'f', risks: [], testing: { automated: [], manual: [] }, steps };
  return [{ index: 0, summary: 'Done.', spots: [], judgementCalls: [], walkthrough, at: 0 }];
}

function renderOverview(state: ShinsaState, task: Task) {
  pushState(state);
  const gate = Object.values(state.gates)[0];
  return render(
    <TooltipProvider>
      <ReviewDraftProvider enabled draftKey={task.id}>
        <OverviewTab state={state} task={task} gate={gate} onOpen={mock()} />
      </ReviewDraftProvider>
      <Toaster />
    </TooltipProvider>
  );
}

beforeEach(() => {
  startFakeServer();
  toast.dismiss();
});

afterEach(() => {
  stopFakeServer();
});

describe('the steps around the merge on the Overview', () => {
  it('lists Pre-merge at the merge gate and holds Merge, saying why, until each is ticked', async () => {
    const task = createTask({
      id: 'task-1',
      stage: 'awaiting_merge',
      pullRequest: createPullRequest({ number: 42 }),
      phaseReports: reportWith([SECRET, MIGRATION]),
    });
    const gate = createGate({ id: 'gate-1', taskId: 'task-1', type: 'merge' });
    const view = renderOverview(createShinsaState({ tasks: [task], gates: [gate] }), task);
    expect(view.getByText('Pre-merge steps')).toBeTruthy();
    expect(view.getByText('0 of 1 done')).toBeTruthy();
    expect(view.queryByText('Run the migration')).toBeNull();
    const merge = view.getByRole('button', { name: 'Merge #42' }) as HTMLButtonElement;
    expect(merge.disabled).toBe(true);
    expect(await findTooltipText(merge.parentElement as HTMLElement)).toBe('Tick the pre-merge step first');
    fireEvent.click(view.getByRole('checkbox', { name: 'Set STRIPE_WEBHOOK_SECRET' }));
    await waitFor(() =>
      expect(listSentCommands()).toEqual([
        {
          type: 'merge_step.tick',
          taskId: 'task-1',
          key: resolveMergeStepKey(SECRET),
          done: true,
        },
      ])
    );
  });

  it('lets Merge go once every step before it is ticked', () => {
    const task = createTask({
      id: 'task-1',
      stage: 'awaiting_merge',
      pullRequest: createPullRequest({ number: 42 }),
      phaseReports: reportWith([SECRET]),
      mergeStepsDone: [resolveMergeStepKey(SECRET)],
    });
    const gate = createGate({ id: 'gate-1', taskId: 'task-1', type: 'merge' });
    const view = renderOverview(createShinsaState({ tasks: [task], gates: [gate] }), task);
    expect(view.getByText('All done')).toBeTruthy();
    expect((view.getByRole('button', { name: 'Merge #42' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('opens a merged task on the steps left after the merge, each tickable and its command run in a terminal', async () => {
    const task = createTask({
      id: 'task-1',
      stage: 'merged',
      pullRequest: createPullRequest({ number: 42, state: 'merged' }),
      phaseReports: reportWith([SECRET, MIGRATION]),
      mergeStepsDone: [resolveMergeStepKey(SECRET)],
    });
    const gate = createGate({ id: 'gate-1', taskId: 'task-1', type: 'post_merge' });
    const state = createShinsaState({ tasks: [task], gates: [gate] });
    const overview = renderOverview(state, task);
    expect(overview.getByText('Merged. 1 step left to do.')).toBeTruthy();
    expect(screen.getAllByText('Post-merge · 1 step left').length).toBeGreaterThan(0);
    overview.unmount();
    const onRun = mock();
    const onTick = mock();
    const card = render(
      <TooltipProvider>
        <CommandRunnerProvider runner={{ run: onRun, folder: '/tmp/worktrees/merged' }}>
          <PostMergeCard state={state} task={task} onTick={onTick} />
        </CommandRunnerProvider>
      </TooltipProvider>
    );
    fireEvent.click(card.getByRole('button', { name: 'Run in terminal' }));
    expect(onRun).toHaveBeenCalledWith('bun run db:migrate');
    fireEvent.click(card.getByRole('checkbox', { name: 'Run the migration' }));
    await waitFor(() =>
      expect(onTick).toHaveBeenCalledWith(expect.objectContaining({ title: 'Run the migration' }), true)
    );
  });

  it('keeps the steps after an earlier merge on the Overview while a later round works', () => {
    const task = createTask({
      id: 'task-1',
      stage: 'building',
      pullRequest: createPullRequest({ number: 42, state: 'merged' }),
      phaseReports: reportWith([MIGRATION]),
    });
    const gate = createGate({ id: 'gate-1', taskId: 'task-1', type: 'post_merge' });
    const run = createRun({ id: 'run-1', taskId: 'task-1' });
    const view = renderOverview(createShinsaState({ tasks: [task], gates: [gate], runs: [run] }), task);
    expect(
      view.getByText(
        'An earlier round merged and left these steps for you. The task is done once each is ticked.'
      )
    ).toBeTruthy();
    expect(view.getByRole('checkbox', { name: 'Run the migration' })).toBeTruthy();
  });
});
