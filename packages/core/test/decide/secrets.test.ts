import { describe, expect, test } from 'bun:test';
import { buildAll, createHarness, createTask, PASSING } from '../harness.ts';

const REF = `secret-ref:${'a'.repeat(32)}`;

function asking() {
  const harness = createHarness();
  const taskId = createTask(harness);
  const runId = harness.activeRun(taskId).id;
  harness.send({
    type: 'agent.request_secret',
    runId,
    gateId: 'g1',
    label: 'GitHub webhook secret',
    reason: 'Paste the signing secret GitHub shows for the webhook.',
  });
  return { harness, taskId, runId };
}

describe('asking for a secret', () => {
  test('opens a question with a secret field and keeps the run waiting', () => {
    const { harness, taskId, runId } = asking();
    expect(harness.state.gates.g1).toMatchObject({
      taskId,
      kind: 'question',
      purpose: 'agent_question',
      title: 'Paste the signing secret GitHub shows for the webhook.',
      runId,
      secret: { label: 'GitHub webhook secret' },
    });
  });

  test('a repeat of the same request opens nothing new; another run’s gate id is refused', () => {
    const { harness, taskId, runId } = asking();
    const repeat = harness.send({
      type: 'agent.request_secret',
      runId,
      gateId: 'g1',
      label: 'x',
      reason: 'y',
    });
    expect(repeat.events).toHaveLength(0);
    const other = createTask(harness, { request: 'Other' });
    expect(() =>
      harness.send({
        type: 'agent.request_secret',
        runId: harness.activeRun(other).id,
        gateId: 'g1',
        label: 'x',
        reason: 'y',
      })
    ).toThrow('already exists');
    expect(harness.task(taskId).stage).toBe('planning');
  });

  test('needs a label and a reason, and a working role', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const runId = harness.activeRun(taskId).id;
    expect(() =>
      harness.send({ type: 'agent.request_secret', runId, gateId: 'g', label: ' ', reason: 'Why' })
    ).toThrow('Name the secret');
    buildAll(harness, taskId);
    harness.send({ type: 'checks.record', taskId, results: PASSING });
    expect(() =>
      harness.send({
        type: 'agent.request_secret',
        runId: harness.activeRun(taskId).id,
        gateId: 'g',
        label: 'a',
        reason: 'b',
      })
    ).toThrow('A reviewer cannot do that.');
  });
});

describe('answering a secret question', () => {
  test('takes a secret ref and hands the waiting agent its answer', () => {
    const { harness } = asking();
    const decision = harness.send({ type: 'gate.answer', gateId: 'g1', decision: 'answer', response: REF });
    expect(harness.state.gates.g1).toMatchObject({ status: 'answered', response: REF });
    expect(decision.effects).toContainEqual({ kind: 'question.resolve', gateId: 'g1' });
  });

  test('a decline closes it without a value', () => {
    const { harness } = asking();
    harness.send({ type: 'gate.answer', gateId: 'g1', decision: 'reject', response: null });
    expect(harness.state.gates.g1).toMatchObject({ status: 'answered', decision: 'reject', response: null });
  });

  test('refuses the secret itself typed as an answer, so it never reaches the log', () => {
    const { harness } = asking();
    expect(() =>
      harness.send({ type: 'gate.answer', gateId: 'g1', decision: 'answer', response: 'hunter2' })
    ).toThrow('secret field');
    expect(() =>
      harness.send({ type: 'gate.answer', gateId: 'g1', decision: 'approve', response: null })
    ).toThrow('secret field');
    expect(() =>
      harness.send({ type: 'gate.answer', gateId: 'g1', decision: 'answer', response: null })
    ).toThrow('secret field');
    expect(harness.state.gates.g1?.status).toBe('open');
  });
});
