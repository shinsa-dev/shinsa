import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { FixReply, Iteration, ShinsaState, Task } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { fireEvent, render } from '@testing-library/react';
import { ReviewDraftProvider } from '@/components/task/review-draft.tsx';
import { OverviewTab } from '@/routes/task/overview.tsx';
import { pushState, startFakeServer, stopFakeServer } from '../../support/server.ts';
import { createGate, createShinsaState, createTask, NOW } from '../../support/state.ts';

const REPLY: FixReply = {
  headline: 'Slack is under Remote access now.',
  points: [
    { ask: 'Move Slack to General', outcome: 'done', note: 'Right below Remote access.' },
    { ask: 'Does it need a setting?', outcome: 'answered', note: 'Agents & AI Apps.' },
    { ask: 'Replace the stream', outcome: 'not_changed', note: 'Slack does not say it allows it.' },
  ],
  next: 'Restart the engine.',
};

function answered(id: string, headline: string, repliedAt: number): Iteration {
  return {
    id,
    round: 1,
    requests: [{ text: `What I sent for ${id}.`, comments: 1, at: repliedAt - 1000 }],
    reply: { ...REPLY, headline },
    runId: null,
    repliedAt,
  };
}

function renderOverview(state: ShinsaState, task: Task) {
  pushState(state);
  const gate = Object.values(state.gates)[0];
  return render(
    <TooltipProvider>
      <ReviewDraftProvider enabled draftKey={task.id}>
        <OverviewTab state={state} task={task} gate={gate} onOpen={mock()} />
      </ReviewDraftProvider>
    </TooltipProvider>
  );
}

beforeEach(() => {
  localStorage.clear();
  startFakeServer();
});

afterEach(() => {
  stopFakeServer();
});

describe('the reply to your request on the Overview', () => {
  it('leads the review card with each point you raised, then what to do now, the rest folded', () => {
    const task = createTask({
      id: 'task-1',
      stage: 'awaiting_review',
      iterations: [
        answered('one', 'Made the first change.', NOW - 60_000),
        answered('two', REPLY.headline, NOW - 5_000),
      ],
    });
    const gate = createGate({ id: 'gate-1', taskId: 'task-1', type: 'review' });
    const view = renderOverview(createShinsaState({ tasks: [task], gates: [gate] }), task);
    expect(view.getByText(REPLY.headline)).toBeTruthy();
    expect(view.getByText('Move Slack to General')).toBeTruthy();
    expect(view.getAllByLabelText('Done').length).toBeGreaterThan(0);
    expect(view.getByText('Answered')).toBeTruthy();
    expect(view.getByText('Not changed')).toBeTruthy();
    expect(view.getByText('What to do now')).toBeTruthy();
    expect(view.queryByText('What I sent for two.', { exact: false })).toBeNull();
    const sent = view.getByRole('button', { name: 'Expand what you sent' });
    expect(
      sent.compareDocumentPosition(view.getByText(REPLY.headline)) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    fireEvent.click(sent);
    expect(view.getByText(/What I sent for two\./).closest('blockquote')).toBeTruthy();
    expect(view.getByText('Earlier requests')).toBeTruthy();
    expect(view.getByText('Made the first change.')).toBeTruthy();
    expect(view.getByText(/1 done · 1 answered · 1 not changed/)).toBeTruthy();
  });

  it('opens an earlier request to the same report, what you sent folded above it', () => {
    const plain = { ...answered('one', 'Made the first change.', NOW - 60_000) };
    plain.reply = { ...REPLY, headline: 'Made the first change.', next: null };
    const task = createTask({ id: 'task-1', stage: 'building', iterations: [plain] });
    const view = renderOverview(createShinsaState({ tasks: [task] }), task);
    expect(view.getByText('Your requests')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Expand the reply' }));
    expect(view.getByText('Move Slack to General')).toBeTruthy();
    expect(view.queryByText('What to do now')).toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'Expand what you sent' }));
    expect(view.getByText(/What I sent for one\./)).toBeTruthy();
  });

  it('folds nothing after a reply to verdicts alone', () => {
    const verdicts = { text: '', comments: 0, at: NOW - 6_000 };
    const bare = { ...answered('two', REPLY.headline, NOW - 5_000), requests: [verdicts] };
    const task = createTask({ id: 'task-1', stage: 'awaiting_review', iterations: [bare] });
    const gate = createGate({ id: 'gate-1', taskId: 'task-1', type: 'review' });
    const view = renderOverview(createShinsaState({ tasks: [task], gates: [gate] }), task);
    expect(view.getByText(REPLY.headline)).toBeTruthy();
    expect(view.queryByRole('button', { name: 'Expand what you sent' })).toBeNull();
  });

  it('lists a plan you asked to change with what you sent', () => {
    const task = createTask({
      id: 'task-1',
      stage: 'building',
      plan: {
        version: 2,
        body: '',
        document: null,
        proposedAt: NOW - 10_000,
        changeSummary: 'The bot uses the Events API.',
        feedback: 'Use the Events API instead.',
      },
    });
    const view = renderOverview(createShinsaState({ tasks: [task] }), task);
    expect(view.getByText('The bot uses the Events API.')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Expand the plan change' }));
    expect(view.getByText('Use the Events API instead.')).toBeTruthy();
  });

  it('shows the request the agent is working on while it fixes', () => {
    const task = createTask({
      id: 'task-1',
      stage: 'fixing',
      iterations: [{ ...answered('one', 'x', NOW), reply: null, repliedAt: null }],
    });
    const view = renderOverview(createShinsaState({ tasks: [task] }), task);
    expect(view.getByText('Your request')).toBeTruthy();
    expect(view.getByText(/What I sent for one\./)).toBeTruthy();
  });
});
