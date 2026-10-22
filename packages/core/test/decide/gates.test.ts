import { describe, expect, test } from 'bun:test';
import { applyEvent, listOpenGates } from '../../src/index.ts';
import {
  approve,
  createHarness,
  createTask,
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

    const asking = createTask(harness, { intent: 'Ask' });
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
    expect(harness.task(taskId)).toMatchObject({ stage: 'building', specAnswers: 'Use 240px.' });
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
