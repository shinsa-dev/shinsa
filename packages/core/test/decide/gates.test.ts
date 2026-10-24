import { describe, expect, test } from 'bun:test';
import { applyEvent, type Gate, isHumanOnlyGate, listOpenGates } from '../../src/index.ts';
import {
  approve,
  buildAll,
  createHarness,
  createTask,
  PASSING,
  proposePlan,
  pullRequest,
  reachReviewGate,
  reachShipping,
} from '../harness.ts';

describe('answering a gate', () => {
  test('a gate is answered once', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachReviewGate(harness, taskId);
    const gateId = harness.openGate(taskId).id;
    approve(harness, taskId);
    expect(() => harness.send({ type: 'gate.answer', gateId, decision: 'approve', response: null })).toThrow(
      'This has already been answered.'
    );
    expect(() =>
      harness.send({ type: 'gate.answer', gateId: 'nope', decision: 'approve', response: null })
    ).toThrow('No gate nope');
  });

  test('each kind of gate takes only the decisions that mean something for it', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachReviewGate(harness, taskId);
    const review = harness.openGate(taskId).id;
    expect(() =>
      harness.send({ type: 'gate.answer', gateId: review, decision: 'answer', response: 'ok' })
    ).toThrow('Approve it, ask for changes or reject it.');

    const asking = createTask(harness, { request: 'Ask' });
    const runId = harness.activeRun(asking).id;
    harness.send({ type: 'agent.ask', runId, gateId: 'q1', question: 'Which tab?', context: null });
    expect(() =>
      harness.send({ type: 'gate.answer', gateId: 'q1', decision: 'approve', response: 'x' })
    ).toThrow('Answer the question.');
    expect(() =>
      harness.send({ type: 'gate.answer', gateId: 'q1', decision: 'answer', response: ' ' })
    ).toThrow('Write an answer first.');

    harness.send({ type: 'effect.fail', taskId: asking, title: 'Broke', detail: 'x' });
    const failure = harness.openGate(asking).id;
    expect(() =>
      harness.send({ type: 'gate.answer', gateId: failure, decision: 'revise', response: null })
    ).toThrow('Retry or cancel the task.');
    expect(listOpenGates(harness.state)).toHaveLength(2);
  });

  test('an answer to a failure retries the step with it as guidance', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    proposePlan(harness, taskId);
    harness.send({ type: 'effect.fail', taskId, title: 'Broke', detail: 'x' });
    harness.send({
      type: 'gate.answer',
      gateId: harness.openGate(taskId).id,
      decision: 'answer',
      response: 'Use the grid.',
    });
    expect(harness.activeRun(taskId).prompt).toContain('Guidance from the human: Use the grid.');
  });

  test('approving a plan stores the answers to its questions and starts building', () => {
    const harness = createHarness();
    harness.send({ type: 'settings.change', patch: { approvePlans: true } });
    const taskId = createTask(harness, { size: 'large' });
    proposePlan(harness, taskId);
    approve(harness, taskId, '  Use 240px.  ');
    expect(harness.task(taskId)).toMatchObject({ stage: 'building', planAnswers: 'Use 240px.' });
    expect(harness.activeRun(taskId).prompt).toContain('The human answered:\nUse 240px.');
  });

  test('asking for changes to a plan sends it back to the planner', () => {
    const harness = createHarness();
    harness.send({ type: 'settings.change', patch: { approvePlans: true } });
    const taskId = createTask(harness, { size: 'large' });
    proposePlan(harness, taskId);
    harness.send({
      type: 'gate.answer',
      gateId: harness.openGate(taskId).id,
      decision: 'revise',
      response: null,
    });
    expect(harness.task(taskId).stageReason).toBe('revising the plan');
    expect(harness.activeRun(taskId).prompt).toContain('Feedback on the previous plan:\nRevise the plan.');
  });

  test('asking for changes at the review gate starts a fixer, then checks and review again', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachReviewGate(harness, taskId);
    harness.send({
      type: 'gate.answer',
      gateId: harness.openGate(taskId).id,
      decision: 'revise',
      response: 'Dark mode.',
    });
    const run = harness.activeRun(taskId);
    expect(run.role).toBe('fixer');
    expect(run.prompt).toContain('Dark mode.');
    harness.send({ type: 'agent.complete_fix', runId: run.id, summary: 'Added dark mode.' });
    expect(harness.task(taskId).stage).toBe('checking');
  });

  test('asking for changes at the merge gate without words still starts a fix', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachShipping(harness, taskId);
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest() });
    harness.send({
      type: 'gate.answer',
      gateId: harness.openGate(taskId).id,
      decision: 'revise',
      response: null,
    });
    expect(harness.activeRun(taskId).prompt).toContain('Revise the work.');
    expect(harness.task(taskId).fixFor).toBe('you');
  });

  test('rejecting a decision cancels the task', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachReviewGate(harness, taskId);
    harness.send({
      type: 'gate.answer',
      gateId: harness.openGate(taskId).id,
      decision: 'reject',
      response: null,
    });
    expect(harness.task(taskId)).toMatchObject({ stage: 'cancelled', stageReason: 'review rejected' });
  });

  test('a question left open by an older version, whose agent is gone, retries the step with the answer', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    proposePlan(harness, taskId);
    const builder = harness.activeRun(taskId);
    const state = harness.state;
    applyEvent(state, {
      type: 'run.ended',
      runId: builder.id,
      outcome: 'cancelled',
      summary: null,
      seq: state.seq + 1,
      at: 0,
    });
    applyEvent(state, {
      type: 'gate.opened',
      gate: {
        id: 'legacy',
        taskId,
        kind: 'question',
        purpose: 'agent_question',
        status: 'open',
        title: 'Which tab?',
        body: '',
        runId: builder.id,
        openedAt: 0,
        answeredAt: null,
        decision: null,
        response: null,
      },
      seq: state.seq + 1,
      at: 0,
    });
    harness.send({ type: 'gate.answer', gateId: 'legacy', decision: 'answer', response: 'The first.' });
    expect(harness.activeRun(taskId).prompt).toContain(
      'You asked: Which tab?\nThe human answered: The first.'
    );
    expect(harness.effectsOf('question.resolve').map((effect) => effect.gateId)).not.toContain('legacy');
  });
});

describe('approving a plan', () => {
  function planGate() {
    const harness = createHarness();
    harness.send({ type: 'settings.change', patch: { approvePlans: true } });
    const taskId = createTask(harness, { size: 'large' });
    proposePlan(harness, taskId);
    return { harness, taskId, gate: harness.openGate(taskId) };
  }

  test('approves the version you read and hands the builder that version', () => {
    const { harness, taskId, gate } = planGate();
    harness.send({
      type: 'gate.answer',
      gateId: gate.id,
      decision: 'approve',
      response: null,
      planVersion: 1,
    });
    expect(harness.task(taskId).plan?.approvedAt).toBeNumber();
    expect(harness.activeRun(taskId).prompt).toContain(
      'This is plan version 1, approved by the human. Follow this exact version'
    );
  });

  test('refuses an approval for a version that is no longer current', () => {
    const { harness, gate } = planGate();
    expect(() =>
      harness.send({
        type: 'gate.answer',
        gateId: gate.id,
        decision: 'approve',
        response: null,
        planVersion: 3,
      })
    ).toThrow('The plan changed to version 1 after you opened it.');
  });

  test('refuses an approval of a plan that is being revised or was replaced', () => {
    const { harness, taskId, gate } = planGate();
    harness.send({ type: 'task.message', taskId, text: 'Smaller, please.' });
    expect(() =>
      harness.send({ type: 'gate.answer', gateId: gate.id, decision: 'approve', response: null })
    ).toThrow('The planner is revising this plan.');
    proposePlan(harness, taskId);
    expect(() =>
      harness.send({ type: 'gate.answer', gateId: gate.id, decision: 'approve', response: null })
    ).toThrow('The plan changed to version 2 after you opened it.');
    harness.send({ type: 'task.cancel', taskId });
    expect(() =>
      harness.send({ type: 'gate.answer', gateId: gate.id, decision: 'approve', response: null })
    ).toThrow('This has already been answered.');
  });

  test('a plan gate from before versions still approves', () => {
    const { harness, taskId, gate } = planGate();
    harness.send({ type: 'gate.answer', gateId: gate.id, decision: 'approve', response: 'Use the flag.' });
    expect(harness.task(taskId).planAnswers).toBe('Use the flag.');
    expect(harness.task(taskId).stage).toBe('building');
  });
});

describe('verdicts on review findings', () => {
  function reviewWithFindings() {
    const harness = createHarness();
    const taskId = createTask(harness);
    buildAll(harness, taskId);
    harness.send({ type: 'checks.record', taskId, results: PASSING });
    harness.send({
      type: 'agent.report_review',
      runId: harness.activeRun(taskId).id,
      findings: [
        { severity: 'suggestion', file: 'a.ts', line: 3, message: 'Rename it.' },
        { severity: 'suggestion', file: 'b.ts', line: 9, message: 'Cache it.' },
      ],
    });
    return { harness, taskId, gate: harness.openGate(taskId) };
  }

  test('asking for changes sends the fixer only what you kept and leaves the rest alone', () => {
    const { harness, taskId, gate } = reviewWithFindings();
    harness.send({
      type: 'gate.answer',
      gateId: gate.id,
      decision: 'revise',
      response: 'Keep the API stable.',
      verdicts: [
        { index: 0, verdict: 'fix', note: null },
        { index: 1, verdict: 'dismiss', note: 'Premature.' },
      ],
    });
    const prompt = harness.activeRun(taskId).prompt ?? '';
    expect(prompt.startsWith('The human looked at the work and decided on each review finding.')).toBe(true);
    expect(prompt).toContain('Fix these:\n- [suggestion] a.ts:3: Rename it.');
    expect(prompt).toContain(
      'Leave these alone; the human dismissed them:\n- [suggestion] b.ts:9: Cache it. (the human: Premature.)'
    );
    expect(prompt).toContain('The human also wrote:\nKeep the API stable.');
    expect(harness.task(taskId).findings.map((finding) => finding.verdict)).toEqual(['fix', 'dismiss']);
    expect(harness.task(taskId).dismissedFindings).toHaveLength(1);
    expect(harness.state.gates[gate.id]?.verdicts).toHaveLength(2);
  });

  test('approving can dismiss findings but cannot ask for a fix', () => {
    const { harness, taskId, gate } = reviewWithFindings();
    expect(() =>
      harness.send({
        type: 'gate.answer',
        gateId: gate.id,
        decision: 'approve',
        response: null,
        verdicts: [{ index: 0, verdict: 'fix', note: null }],
      })
    ).toThrow('Approving ships the work as it is.');
    harness.send({
      type: 'gate.answer',
      gateId: gate.id,
      decision: 'approve',
      response: null,
      verdicts: [{ index: 1, verdict: 'dismiss', note: null }],
    });
    expect(harness.task(taskId).stage).toBe('shipping');
  });

  test('a verdict must name a finding of this review, once', () => {
    const { harness, gate } = reviewWithFindings();
    const send = (verdicts: { index: number; verdict: 'fix' | 'dismiss'; note: null }[]) =>
      harness.send({ type: 'gate.answer', gateId: gate.id, decision: 'revise', response: null, verdicts });
    expect(() => send([{ index: 5, verdict: 'fix', note: null }])).toThrow('Each verdict must name');
    expect(() =>
      send([
        { index: 0, verdict: 'fix', note: null },
        { index: 0, verdict: 'dismiss', note: null },
      ])
    ).toThrow('Each verdict must name');
  });

  test('only review findings take verdicts, and an empty list is no verdict', () => {
    const harness = createHarness();
    harness.send({ type: 'settings.change', patch: { approvePlans: true } });
    const taskId = createTask(harness, { size: 'large' });
    proposePlan(harness, taskId);
    const gate = harness.openGate(taskId);
    expect(() =>
      harness.send({
        type: 'gate.answer',
        gateId: gate.id,
        decision: 'revise',
        response: 'x',
        verdicts: [{ index: 0, verdict: 'fix', note: null }],
      })
    ).toThrow('Only review findings take a verdict.');
    harness.send({ type: 'gate.answer', gateId: gate.id, decision: 'approve', response: null, verdicts: [] });
    expect(harness.state.gates[gate.id]?.verdicts).toBeUndefined();
  });
});

describe('decisions only the human makes', () => {
  const GATES: [string, Pick<Gate, 'kind' | 'purpose'> & Partial<Pick<Gate, 'secret'>>, boolean][] = [
    ['plan', { kind: 'plan', purpose: 'decision' }, true],
    ['review', { kind: 'review', purpose: 'decision' }, true],
    ['merge', { kind: 'merge', purpose: 'decision' }, true],
    ['operation', { kind: 'question', purpose: 'operation' }, true],
    ['your OK', { kind: 'question', purpose: 'change' }, true],
    ['secret', { kind: 'question', purpose: 'agent_question', secret: { label: 'Token' } }, true],
    ['sign-in', { kind: 'question', purpose: 'sign_in' }, true],
    ['question', { kind: 'question', purpose: 'agent_question' }, false],
    ['failure', { kind: 'question', purpose: 'failure' }, false],
    ['setup', { kind: 'question', purpose: 'configuration' }, false],
  ];

  test('names exactly the gates an agent may never answer for the human', () => {
    for (const [name, gate, human] of GATES) expect(isHumanOnlyGate(gate), name).toBe(human);
  });

  test('core refuses an answer to them sent on an agent’s behalf, whatever the decision, and records nothing', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachReviewGate(harness, taskId);
    const gateId = harness.openGate(taskId).id;
    for (const decision of ['approve', 'revise', 'reject', 'answer'] as const) {
      const before = harness.events.length;
      expect(() =>
        harness.send(
          { type: 'gate.answer', gateId, decision, response: 'Ship it.' },
          { onBehalf: true, byTask: 'other' }
        )
      ).toThrow('Only the human decides this.');
      expect(harness.events).toHaveLength(before);
    }
    expect(harness.openGate(taskId).id).toBe(gateId);
    approve(harness, taskId);
    expect(harness.task(taskId).stage).toBe('shipping');
  });

  test('a message or a retry on your behalf never signs in for you, and records nothing', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const run = harness.activeRun(taskId);
    harness.send({
      type: 'run.end',
      runId: run.id,
      outcome: 'failed',
      summary: 'Signed out.',
      failure: {
        class: 'auth',
        message: 'Claude is signed out.',
        code: 'authentication_failed',
        retryable: null,
        resetAt: null,
        account: { id: 'acc-work', email: 'work@example.com' },
      },
    });
    const gateId = harness.openGate(taskId).id;
    const before = harness.events.length;
    expect(() =>
      harness.send({ type: 'task.message', taskId, text: 'Carry on.' }, { onBehalf: true, byTask: 'other' })
    ).toThrow('Only the human decides this.');
    expect(() => harness.send({ type: 'task.retry', taskId }, { onBehalf: true, byTask: 'other' })).toThrow(
      'This task waits for a decision only the human makes.'
    );
    expect(harness.events).toHaveLength(before);
    expect(harness.openGate(taskId).id).toBe(gateId);
    harness.send({ type: 'task.message', taskId, text: 'Carry on.' });
    expect(harness.state.gates[gateId]?.status).toBe('answered');
  });

  test('an agent cannot mark a task done for you while it waits on a decision only you make', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachReviewGate(harness, taskId);
    expect(() =>
      harness.send({ type: 'task.complete', taskId }, { onBehalf: true, byTask: 'other' })
    ).toThrow('This task waits for a decision only the human makes.');
    expect(harness.task(taskId).stage).toBe('awaiting_review');
    harness.send({ type: 'task.complete', taskId });
    expect(harness.task(taskId).stage).toBe('done');
  });

  test('an agent may still answer another agent’s question and retry a paused task for the human', () => {
    const harness = createHarness();
    const asking = createTask(harness);
    harness.send({
      type: 'agent.ask',
      runId: harness.activeRun(asking).id,
      gateId: 'q1',
      question: 'Which store?',
      context: null,
    });
    harness.send(
      { type: 'gate.answer', gateId: 'q1', decision: 'answer', response: 'Redis.' },
      { onBehalf: true }
    );
    expect(harness.state.gates.q1?.status).toBe('answered');
    const paused = createTask(harness, { request: 'Paused' });
    harness.send({ type: 'effect.fail', taskId: paused, title: 'Could not run the checks', detail: 'x' });
    harness.send(
      { type: 'gate.answer', gateId: harness.openGate(paused).id, decision: 'approve', response: null },
      { onBehalf: true }
    );
    expect(listOpenGates(harness.state, paused)).toEqual([]);
    expect(() =>
      harness.send(
        { type: 'gate.answer', gateId: 'gone', decision: 'approve', response: null },
        { onBehalf: true }
      )
    ).toThrow('No gate gone');
  });
});
