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
  if (engine) engines.push(spyOnEngine(engine));
  return render(
    <TooltipProvider>
      <ReviewDraftProvider enabled draftKey={task.id}>
        <ReviewActions state={state} task={task} gate={gate} />
      </ReviewDraftProvider>
      <Toaster />
    </TooltipProvider>
  );
}

async function pickFixChoice(name: string) {
  fireEvent.click(screen.getByRole('button', { name: 'More ways to fix' }));
  fireEvent.click(await screen.findByRole('menuitemradio', { name }));
  await waitForGone(() => screen.queryByRole('menu'));
}

const engines: ReturnType<typeof spyOnEngine>[] = [];

beforeEach(() => {
  startFakeServer();
  toast.dismiss();
});

afterEach(() => {
  for (const engine of engines.splice(0)) engine.mockRestore();
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

  it('shows no chevron when nothing is kept to fix', () => {
    const view = renderActions([{ severity: 'optional', file: null, line: null, message: 'Rename it.' }]);
    expect(view.getByRole('button', { name: 'Approve changes' })).toBeTruthy();
    expect(view.queryByRole('button', { name: 'More ways to fix' })).toBeNull();
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
