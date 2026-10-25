import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { Gate, PipelineStep, ShinsaState, Task, TriageDecisions } from '@shinsa/core';
import { Toaster, toast } from '@shinsa/ui/components/sonner';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { fireEvent, render, waitFor, within } from '@testing-library/react';
import { ReviewDraftProvider } from '@/components/task/review-draft.tsx';
import { OverviewTab } from '@/routes/task/overview.tsx';
import { startFakeOnboarding } from '../../support/onboarding.ts';
import { createRound } from '../../support/rounds.ts';
import { listSentCommands, pushState, startFakeServer, stopFakeServer } from '../../support/server.ts';
import { createEvidence, createGate, createRun, createShinsaState, createTask } from '../../support/state.ts';

const FIX: PipelineStep[] = [
  'investigate',
  'plan',
  'build',
  'checks',
  'agent_review',
  'your_review',
  'pull_request',
  'merge',
];

const DECIDED: TriageDecisions = {
  shape: { value: 'answer', why: 'It asks how something works.' },
  start: null,
  priority: { value: 'normal', why: 'Nothing is waiting on it.' },
};

function renderOverview(state: ShinsaState, task: Task, gate?: Gate) {
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

function strip(view: ReturnType<typeof render>) {
  return within(view.getByRole('list', { name: 'Progress' }))
    .getAllByRole('listitem')
    .map((item) => item.textContent);
}

function proposing() {
  const task = createTask({
    id: 't',
    stage: 'awaiting_proposal',
    pipeline: ['investigate', 'your_ok', ...FIX.slice(1)],
    shapeChanges: [
      {
        from: ['investigate'],
        to: ['investigate', 'your_ok', ...FIX.slice(1)],
        by: 'agent',
        reason: 'The stall comes from leaked connections.',
        at: 0,
      },
    ],
    result: { step: 'investigate', body: 'The pool runs **dry**.', runId: null, at: 0 },
    proposal: {
      request: 'Release the connection on a timeout.',
      why: 'The stall comes from leaked connections.',
      status: 'open',
      runId: null,
      at: 0,
    },
  });
  const gate = createGate({
    id: 'g',
    taskId: 't',
    type: 'proposal',
    title: 'Turn this investigation into a fix?',
  });
  return { task, gate, state: createShinsaState({ tasks: [task], gates: [gate] }) };
}

beforeEach(() => {
  startFakeServer();
  toast.dismiss();
});

afterEach(() => {
  stopFakeServer();
});

describe('the change gate on the Overview', () => {
  it('shows what the investigation proposes and why, under the gate’s question', () => {
    const { task, gate, state } = proposing();
    const view = renderOverview(state, task, gate);
    const card = within(view.container.querySelector('section') as HTMLElement);
    expect(card.getByText('Turn this investigation into a fix?')).toBeTruthy();
    expect(card.getByText('The investigation proposes a fix')).toBeTruthy();
    expect(card.getByText('Change to approve')).toBeTruthy();
    expect(card.getByText('The stall comes from leaked connections.')).toBeTruthy();
    expect(card.getByText('Release the connection on a timeout.')).toBeTruthy();
    expect(view.queryByRole('heading', { name: 'Diagnosis' })).toBeNull();
    expect(card.getByText('dry')).toBeTruthy();
  });

  it('makes it a change from the primary action', async () => {
    const { task, gate, state } = proposing();
    const view = renderOverview(state, task, gate);
    fireEvent.click(view.getByRole('button', { name: 'Make it a change' }));
    expect(listSentCommands()).toEqual([
      { type: 'gate.answer', gateId: 'g', decision: 'approve', response: null },
    ]);
    expect(await view.findByText('Approved. Planning the change now.')).toBeTruthy();
  });

  it('keeps it as an investigation from the quiet footer link', async () => {
    const { task, gate, state } = proposing();
    const view = renderOverview(state, task, gate);
    fireEvent.click(view.getByRole('button', { name: 'Keep it as an investigation' }));
    await waitFor(() =>
      expect(listSentCommands()).toEqual([
        { type: 'gate.answer', gateId: 'g', decision: 'reject', response: null },
      ])
    );
  });
});

describe('the Overview for each kind of task', () => {
  it('shows a finished report without a summary or code panels, and takes a follow-up', async () => {
    const task = createTask({
      id: 't',
      stage: 'done',
      pipeline: ['research'],
      result: { step: 'research', body: 'Three options compared.', runId: null, at: 0 },
    });
    const view = renderOverview(createShinsaState({ tasks: [task] }), task);
    const card = within(view.container.querySelector('section') as HTMLElement);
    expect(card.getByText('Wrote the report')).toBeTruthy();
    expect(card.getByText('Three options compared.')).toBeTruthy();
    expect(view.queryByRole('heading', { name: 'Report' })).toBeNull();
    expect(view.queryByRole('heading', { name: 'Summary' })).toBeNull();
    const box = view.getByPlaceholderText('Ask a follow-up, or for more work.');
    fireEvent.change(box, { target: { value: 'Which is cheapest?' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() =>
      expect(listSentCommands()).toEqual([{ type: 'task.message', taskId: 't', text: 'Which is cheapest?' }])
    );
  });

  it('shows the outcome of a finished operation and takes a follow-up or more work', () => {
    const task = createTask({
      id: 't',
      stage: 'done',
      pipeline: ['plan', 'operate'],
      result: { step: 'operate', body: 'Rotated 3 keys.', runId: null, at: 0 },
    });
    const view = renderOverview(createShinsaState({ tasks: [task] }), task);
    expect(view.getByText('Reported the outcome')).toBeTruthy();
    expect(
      view.getByText(
        'Ask a follow-up or for more work in the chat. The agent answers a follow-up; more work starts a new round.'
      )
    ).toBeTruthy();
    expect(
      view.getByRole('textbox', {
        name: 'Ask a follow-up, or for more work.',
      })
    ).toBeTruthy();
  });

  it('draws the whole pipeline of find and fix in the stage strip, with the summary of the change', () => {
    const task = createTask({
      id: 't',
      stage: 'planning',
      pipeline: FIX,
      result: { step: 'investigate', body: 'Found it.', runId: null, at: 0 },
    });
    const view = renderOverview(createShinsaState({ tasks: [task] }), task);
    expect(strip(view)).toEqual([
      'Repository',
      'Investigate',
      'Plan',
      'Build',
      'Checks',
      'Your review',
      'Pull request',
      'Merge',
    ]);
    expect(view.getByRole('heading', { name: 'Diagnosis' })).toBeTruthy();
    expect(view.getByRole('heading', { name: 'Summary' })).toBeTruthy();
  });
});

describe('what Shinsa decided, on the Overview', () => {
  it('says each value once: the Overview has no second line of decisions', () => {
    const task = createTask({ id: 't', stage: 'answering', pipeline: ['answer'], triageDecisions: DECIDED });
    const view = renderOverview(createShinsaState({ tasks: [task] }), task);
    expect(view.queryByLabelText('What Shinsa decided')).toBeNull();
    expect(view.queryByText('Auto')).toBeNull();
    expect(view.queryByText('Answer only')).toBeNull();
  });
});

describe('steps the agent composed, on the Overview', () => {
  const COMPOSED: PipelineStep[] = ['investigate', 'your_ok', 'plan', 'operate'];

  function composed(overrides: Partial<Task> = {}) {
    return createTask({
      id: 't',
      stage: 'investigating',
      pipeline: COMPOSED,
      triageDecisions: { ...DECIDED, shape: { value: 'change', why: 'It asks for work.' } },
      shapeChanges: [
        { from: ['plan', 'operate'], to: COMPOSED, by: 'agent', reason: 'Find what is stuck first.', at: 1 },
      ],
      ...overrides,
    });
  }

  it('draw your OK in the stage strip', () => {
    const task = composed();
    const view = renderOverview(createShinsaState({ tasks: [task] }), task);
    expect(strip(view)).toEqual(['Repository', 'Investigate', 'Your OK', 'Plan', 'Run']);
  });

  it('ask for your OK with what comes next, and plan the operation from it', async () => {
    const task = composed({
      stage: 'awaiting_proposal',
      result: { step: 'investigate', body: 'Two exports hold the lock.', runId: null, at: 0 },
      proposal: {
        request: 'Plan the operation. You approve the plan before anything runs.',
        why: 'Find what is stuck first.',
        status: 'open',
        runId: null,
        at: 0,
      },
    });
    const gate = createGate({
      id: 'g',
      taskId: 't',
      type: 'proposal',
      title: 'Run an operation from this diagnosis?',
    });
    const view = renderOverview(createShinsaState({ tasks: [task], gates: [gate] }), task, gate);
    expect(view.getByText('The diagnosis is in')).toBeTruthy();
    expect(view.getByText('What comes next')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Plan the operation' }));
    expect(listSentCommands()).toEqual([
      { type: 'gate.answer', gateId: 'g', decision: 'approve', response: null },
    ]);
    expect(await view.findByText('Approved. Planning the operation now.')).toBeTruthy();
  });
});

describe('the evidence on the Overview', () => {
  let fake: ReturnType<typeof startFakeOnboarding>;

  beforeEach(() => {
    fake = startFakeOnboarding({
      'GET /api/evidence/first.log': { answer: 'First round output.' },
      'GET /api/evidence/second.log': { answer: 'Second round output.' },
    });
  });

  afterEach(() => {
    fake.stop();
  });

  it('shows only the current round’s evidence', async () => {
    const task = createTask({
      id: 't',
      rounds: [createRound({ number: 1 }), createRound({ number: 2, status: 'active', outcome: null })],
    });
    const evidence = [
      createEvidence({ id: 'first', taskId: 't', title: 'Round one log', uri: '/api/evidence/first.log' }),
      createEvidence({
        id: 'second',
        taskId: 't',
        round: 2,
        title: 'Round two log',
        uri: '/api/evidence/second.log',
      }),
    ];
    const view = renderOverview(createShinsaState({ tasks: [task], evidence }), task);
    expect(await view.findByText(/Second round output\./)).toBeTruthy();
    expect(view.getByText('Round two log')).toBeTruthy();
    expect(view.queryByText('Round one log')).toBeNull();
    expect(view.queryByText(/First round output\./)).toBeNull();
  });
});

describe('the Overview while the steps are still being worked out', () => {
  const AUTO = { shape: true, start: true, priority: true };

  it('shows no step strip until triage and the agent settle the steps', () => {
    const triage = createTask({ id: 't', stage: 'triage', stageReason: 'choosing the kind', auto: AUTO });
    const view = renderOverview(createShinsaState({ tasks: [triage] }), triage);
    expect(view.getByLabelText('Progress').textContent).toBe('Working out the steps');
    expect(view.getByLabelText('Progress').querySelector('[data-slot="spinner"]')).not.toBeNull();
    view.unmount();
    const planning = createTask({ id: 't', stage: 'planning', pipeline: FIX.slice(1), auto: AUTO });
    const planned = renderOverview(createShinsaState({ tasks: [planning] }), planning);
    expect(planned.getByLabelText('Progress').textContent).toBe('Working out the steps');
    planned.unmount();
    const answering = createTask({ id: 't', stage: 'answering', pipeline: ['answer'], auto: AUTO });
    expect(strip(renderOverview(createShinsaState({ tasks: [answering] }), answering))).toEqual(['Answer']);
  });
});

describe('the rounds of a task on its Overview', () => {
  const REPORT = { step: 'research' as const, body: 'Shinsa runs the agents itself.', runId: 'r1', at: 1 };

  it('keeps an earlier round’s report in the Rounds panel, not in a card, while a new round works', () => {
    const task = createTask({
      id: 't',
      stage: 'researching',
      pipeline: ['research'],
      result: null,
      rounds: [
        createRound({
          number: 1,
          title: 'Compare Shinsa with T3 Code',
          status: 'finished',
          pipeline: ['research'],
          pullRequest: null,
          outcome: { goal: null, phases: [], headline: null, result: REPORT.body },
        }),
        createRound({ number: 2, title: 'Say which is better', status: 'active', pipeline: ['research'] }),
      ],
    });
    const state = createShinsaState({
      tasks: [task],
      runs: [createRun({ id: 'r2', taskId: 't', role: 'researcher', round: 2 })],
    });
    const view = renderOverview(state, task);
    expect(view.queryByRole('heading', { name: 'Report' })).toBeNull();
    const earlier = view.getByRole('list', { name: 'Earlier rounds' });
    fireEvent.click(within(earlier).getByRole('button', { name: /round 1/ }));
    expect(
      within(earlier).getByText('Compare Shinsa with T3 Code. Shinsa runs the agents itself.')
    ).toBeTruthy();
  });

  it('shows no card for a report a follow-up in the same round is about to replace', () => {
    const task = createTask({ id: 't', stage: 'researching', pipeline: ['research'], result: REPORT });
    const state = createShinsaState({
      tasks: [task],
      runs: [createRun({ id: 'r2', taskId: 't', role: 'researcher' })],
    });
    const view = renderOverview(state, task);
    expect(view.queryByRole('heading', { name: 'Report' })).toBeNull();
    expect(view.queryByText(REPORT.body)).toBeNull();
  });

  it('puts the earlier rounds under the current round’s answer, never above it', () => {
    const task = createTask({
      id: 't',
      stage: 'done',
      pipeline: ['answer'],
      result: { step: 'answer', body: 'I answer questions about the code.', runId: null, at: 0 },
      rounds: [
        createRound({ number: 1, title: 'Respond to greeting', status: 'finished', pipeline: ['answer'] }),
        createRound({ number: 2, title: 'Say what you can do', status: 'finished', pipeline: ['answer'] }),
      ],
    });
    const view = renderOverview(createShinsaState({ tasks: [task] }), task);
    const text = view.container.textContent ?? '';
    expect(text.indexOf('I answer questions about the code.')).toBeLessThan(
      text.indexOf('Respond to greeting')
    );
    expect(view.getByRole('heading', { name: 'Rounds' })).toBeTruthy();
  });
});
