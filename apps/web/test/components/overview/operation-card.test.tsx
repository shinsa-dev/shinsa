import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import type { Gate, Task } from '@shinsa/core';
import { Toaster, toast } from '@shinsa/ui/components/sonner';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { fireEvent, render, waitFor, within } from '@testing-library/react';
import { ReviewDraftProvider } from '@/components/task/review-draft.tsx';
import { OverviewTab } from '@/routes/task/overview.tsx';
import { createPullRequest } from '../../support/pull-request.ts';
import { listSentCommands, pushState, startFakeServer, stopFakeServer } from '../../support/server.ts';
import { createGate, createShinsaState, createTask } from '../../support/state.ts';

const SHA = '9f2c4e1b7a3d5e60c8f1a2b3c4d5e6f708192a3b';

const BODY = [
  'Pull request #318 merged as `9f2c4e1`. The merged code can differ from the plan you approved, so check it before the operation runs.',
  '',
  '## Operation',
  '1. Run the backfill as a dry run.',
  '2. Run it for real.',
  '',
  '## Impact',
  'Sets the currency on about 12,400 products.',
].join('\n');

function waiting(task: Partial<Task> = {}, gate: Partial<Gate> = {}) {
  const subject = createTask({
    id: 't',
    stage: 'awaiting_operation',
    pipeline: ['plan', 'build', 'checks', 'agent_review', 'your_review', 'pull_request', 'merge', 'operate'],
    pullRequest: createPullRequest({ number: 318, state: 'merged', mergeCommit: SHA }),
    ...task,
  });
  const opened = createGate({
    id: 'g',
    taskId: 't',
    kind: 'question',
    purpose: 'operation',
    title: 'The change merged. Run the operation now?',
    body: BODY,
    commit: SHA,
    ...gate,
  });
  return { task: subject, gate: opened, state: createShinsaState({ tasks: [subject], gates: [opened] }) };
}

function renderOverview({ task, gate, state }: ReturnType<typeof waiting>) {
  pushState(state);
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

describe('the operation gate after the merge', () => {
  it('shows the gate’s question, the merged pull request and commit, then the operation and its impact', () => {
    const view = renderOverview(waiting());
    const card = within(view.container.querySelector('section') as HTMLElement);
    expect(card.getByText('Operation to confirm')).toBeTruthy();
    expect(card.getByText('The change merged. Run the operation now?')).toBeTruthy();
    expect(card.getByText('#318')).toBeTruthy();
    expect(card.getByRole('button', { name: `Copy the commit ${SHA}` }).textContent).toBe('9f2c4e1');
    expect(
      card.getByText(
        'The merged code can differ from the plan you approved, so check it before the operation runs.'
      )
    ).toBeTruthy();
    expect(card.queryByText(/Pull request #318 merged as/)).toBeNull();
    expect(card.getByRole('heading', { name: 'Operation' })).toBeTruthy();
    expect(card.getByText('Run the backfill as a dry run.')).toBeTruthy();
    expect(card.getByRole('heading', { name: 'Impact' })).toBeTruthy();
  });

  it('keeps the whole body when neither a commit nor a pull request is known', () => {
    const view = renderOverview(waiting({ pullRequest: null }, { commit: null, body: 'The change merged.' }));
    const card = within(view.container.querySelector('section') as HTMLElement);
    expect(card.getByText('The change merged.')).toBeTruthy();
    expect(card.queryByText('Merged')).toBeNull();
  });

  it('copies the full merged commit from its chip', async () => {
    const write = spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    const view = renderOverview(waiting());
    fireEvent.click(view.getByRole('button', { name: `Copy the commit ${SHA}` }));
    expect(await view.findByText('Copied')).toBeTruthy();
    expect(write).toHaveBeenCalledWith(SHA);
    write.mockRestore();
  });

  it('runs the operation from the primary action', async () => {
    const view = renderOverview(waiting());
    fireEvent.click(view.getByRole('button', { name: 'Run the operation' }));
    expect(listSentCommands()).toEqual([
      { type: 'gate.answer', gateId: 'g', decision: 'approve', response: null },
    ]);
    expect(await view.findByText('Running the operation.')).toBeTruthy();
  });

  it('runs it with your notes as guidance for the operator', async () => {
    const view = renderOverview(waiting());
    const send = view.getByRole('button', { name: 'Run with these notes' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(view.getByRole('textbox', { name: 'Notes for the operator' }), {
      target: { value: '  Skip the archived stores.  ' },
    });
    fireEvent.click(send);
    expect(listSentCommands()).toEqual([
      { type: 'gate.answer', gateId: 'g', decision: 'answer', response: 'Skip the archived stores.' },
    ]);
    expect(await view.findByText('Running the operation with your notes.')).toBeTruthy();
  });

  it('sends the notes with Enter too', async () => {
    const view = renderOverview(waiting());
    const box = view.getByRole('textbox', { name: 'Notes for the operator' });
    fireEvent.keyDown(box, { key: 'Enter' });
    fireEvent.change(box, { target: { value: 'Watch the error rate.' } });
    fireEvent.keyDown(box, { key: 'a' });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() =>
      expect(listSentCommands()).toEqual([
        { type: 'gate.answer', gateId: 'g', decision: 'answer', response: 'Watch the error rate.' },
      ])
    );
  });

  it('says a message in the composer becomes notes for the operator, and runs nothing', async () => {
    const view = renderOverview(waiting());
    const composer = view.getByRole('textbox', {
      name: 'Add notes for the operator. They go with the operation once you run it.',
    });
    fireEvent.change(composer, { target: { value: 'Wait for the deploy.' } });
    fireEvent.click(view.getByRole('button', { name: 'Send message' }));
    expect(listSentCommands()).toEqual([{ type: 'task.message', taskId: 't', text: 'Wait for the deploy.' }]);
    expect(await view.findByText('Saved as notes for the operator.')).toBeTruthy();
  });

  it('shows the notes a message left, and the box adds to them', () => {
    const view = renderOverview(waiting({}, { notes: 'Wait for the deploy.' }));
    expect(view.getByText('Your notes for the operator')).toBeTruthy();
    expect(view.getByText('Wait for the deploy.')).toBeTruthy();
    expect(view.getByRole('textbox', { name: 'Notes for the operator' }).getAttribute('placeholder')).toBe(
      'More notes for the operator, added to yours.'
    );
  });

  it('finishes without the operation only after the confirm dialog', async () => {
    const view = renderOverview(waiting());
    fireEvent.click(view.getByRole('button', { name: 'Finish without it' }));
    expect(view.getByText('Finish without running the operation?')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Keep it' }));
    await waitFor(() => expect(view.queryByText('Finish without running the operation?')).toBeNull());
    expect(listSentCommands()).toEqual([]);
    fireEvent.click(view.getByRole('button', { name: 'Finish without it' }));
    const dialog = within(await view.findByRole('alertdialog'));
    fireEvent.click(dialog.getByRole('button', { name: 'Finish without it' }));
    await waitFor(() =>
      expect(listSentCommands()).toEqual([
        { type: 'gate.answer', gateId: 'g', decision: 'reject', response: null },
      ])
    );
    expect(await view.findByText('Finished without running the operation.')).toBeTruthy();
  });
});
