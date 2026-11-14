import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { type EngineInfo, resolveEngineInfo, type Task, type UserCommand } from '@shinsa/core';
import { Toaster, toast } from '@shinsa/ui/components/sonner';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ReviewActions } from '@/components/overview/review-actions.tsx';
import { ReviewDraftProvider } from '@/components/task/review-draft.tsx';
import { spyOnEngine } from '../../support/engine.ts';
import { findTooltipText } from '../../support/hover.ts';
import { listSentCommands, pushState, startFakeServer, stopFakeServer } from '../../support/server.ts';
import { createGate, createShinsaState, createTask } from '../../support/state.ts';
import { waitForGone } from '../../support/wait.ts';

const FIX_ANSWER: UserCommand = {
  type: 'gate.answer',
  gateId: 'gate-1',
  decision: 'revise',
  response: null,
  verdicts: [{ index: 0, verdict: 'fix', note: null }],
};

function reviewing(findings: Task['findings']) {
  const task = createTask({ id: 'task-1', stage: 'awaiting_review', findings });
  const gate = createGate({ id: 'gate-1', taskId: 'task-1', type: 'review' });
  return { task, gate, state: createShinsaState({ tasks: [task], gates: [gate] }) };
}

const BLOCKING = [{ severity: 'blocking' as const, file: 'src/a.ts', line: 3, message: 'Off by one.' }];

function renderActions(findings: Task['findings'], engine?: EngineInfo) {
  const { task, gate, state } = reviewing(findings);
  pushState(state);
  if (engine) spyOnEngine(engine);
  return render(
    <TooltipProvider>
      <ReviewDraftProvider enabled draftKey={task.id}>
        <ReviewActions state={state} task={task} gate={gate} />
      </ReviewDraftProvider>
      <Toaster />
    </TooltipProvider>
  );
}

async function pickFixChoice(name: string, menu = 'More ways to fix') {
  fireEvent.click(screen.getByRole('button', { name: menu }));
  fireEvent.click(await screen.findByRole('menuitemradio', { name }));
  await waitForGone(() => screen.queryByRole('menu'));
}

beforeEach(() => {
  startFakeServer();
  toast.dismiss();
});

afterEach(() => {
  stopFakeServer();
});

describe('ReviewActions on a review with findings', () => {
  it('fixes the findings by default and offers fixing then approving from the chevron', async () => {
    const view = renderActions(BLOCKING);
    expect(view.getByRole('button', { name: 'Fix 1 finding' })).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'More ways to fix' }));
    const items = await screen.findAllByRole('menuitemradio');
    expect(items.map((item) => [item.textContent, item.getAttribute('aria-checked')])).toEqual([
      ['Fix 1 finding', 'true'],
      ['Fix 1 finding and approve', 'false'],
      ['Fix 1 finding, approve and merge', 'false'],
    ]);
  });

  it('swaps the button to fix and approve, then sends the fix with the approval after it', async () => {
    const view = renderActions(BLOCKING);
    await pickFixChoice('Fix 1 finding and approve');
    const button = view.getByRole('button', { name: 'Fix 1 finding and approve' });
    expect(view.queryByRole('button', { name: 'Fix 1 finding' })).toBeNull();
    expect(await findTooltipText(button.parentElement as HTMLElement)).toBe(
      'Sends the findings you kept, then approves once checks and the agent review pass'
    );
    fireEvent.click(button);
    await waitFor(() => expect(listSentCommands()).toEqual([{ ...FIX_ANSWER, thenApprove: true }]));
    expect(await view.findByText('Sent. Approving once the fix passes.')).toBeTruthy();
  });

  it('goes back to a plain fix when you pick it again', async () => {
    const view = renderActions(BLOCKING);
    await pickFixChoice('Fix 1 finding and approve');
    await pickFixChoice('Fix 1 finding');
    fireEvent.click(view.getByRole('button', { name: 'Fix 1 finding' }));
    await waitFor(() => expect(listSentCommands()).toEqual([FIX_ANSWER]));
  });

  it('fixes, approves and merges in one decision from the chevron', async () => {
    const view = renderActions(BLOCKING);
    await pickFixChoice('Fix 1 finding, approve and merge');
    const button = view.getByRole('button', { name: 'Fix 1 finding, approve and merge' });
    expect(await findTooltipText(button.parentElement as HTMLElement)).toBe(
      'Sends the findings you kept, approves once the fix passes, then merges once the pull request is ready'
    );
    fireEvent.click(button);
    await waitFor(() =>
      expect(listSentCommands()).toEqual([{ ...FIX_ANSWER, thenApprove: true, thenMerge: true }])
    );
  });

  it('shows only Fix N findings on an engine that cannot approve after a fix', () => {
    const engine = resolveEngineInfo('1.0.0');
    const view = renderActions(BLOCKING, {
      ...engine,
      features: engine.features.filter((feature) => feature !== 'review.approve_after_fix'),
    });
    expect(view.getByRole('button', { name: 'Fix 1 finding' })).toBeTruthy();
    expect(view.queryByRole('button', { name: 'More ways to fix' })).toBeNull();
  });
});

const OPTIONAL = [{ severity: 'optional' as const, file: null, line: null, message: 'Rename it.' }];

const APPROVE_ANSWER: UserCommand = {
  type: 'gate.answer',
  gateId: 'gate-1',
  decision: 'approve',
  response: null,
  verdicts: [{ index: 0, verdict: 'dismiss', note: null }],
};

describe('ReviewActions on a review with nothing to fix', () => {
  it('approves by default and offers Approve and merge from the chevron', async () => {
    const view = renderActions(OPTIONAL);
    expect(view.getByRole('button', { name: 'Approve changes' })).toBeTruthy();
    expect(view.queryByRole('button', { name: 'More ways to fix' })).toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'More ways to approve' }));
    const items = await screen.findAllByRole('menuitemradio');
    expect(items.map((item) => [item.textContent, item.getAttribute('aria-checked')])).toEqual([
      ['Approve changes', 'true'],
      ['Approve and merge', 'false'],
    ]);
  });

  it('approves and asks to merge once ready when you pick Approve and merge', async () => {
    const view = renderActions(OPTIONAL);
    await pickFixChoice('Approve and merge', 'More ways to approve');
    const button = view.getByRole('button', { name: 'Approve and merge' });
    expect(await findTooltipText(button.parentElement as HTMLElement)).toBe(
      'Opens the pull request and merges it once CI is green, nothing conflicts and no comment is unread'
    );
    fireEvent.click(button);
    await waitFor(() => expect(listSentCommands()).toEqual([{ ...APPROVE_ANSWER, thenMerge: true }]));
  });

  it('shows no chevron on an engine that cannot merge once ready', () => {
    const engine = resolveEngineInfo('1.0.0');
    const view = renderActions(OPTIONAL, {
      ...engine,
      features: engine.features.filter((feature) => feature !== 'review.approve_and_merge'),
    });
    expect(view.getByRole('button', { name: 'Approve changes' })).toBeTruthy();
    expect(view.queryByRole('button', { name: 'More ways to approve' })).toBeNull();
  });
});
