import { describe, expect, test } from 'bun:test';
import { AUTOPILOT_DONE_LIMIT, listAutopilotDone, type ReviewRatings } from '../../src/index.ts';
import { listOpenGates } from '../../src/state/queries.ts';
import { buildAll, createHarness, createTask, type Harness, PASSING } from '../harness.ts';

const HIGH_LOW: ReviewRatings = { confidence: 'high', risk: 'low' };

function reviewed(harness: Harness) {
  const taskId = createTask(harness);
  buildAll(harness, taskId);
  harness.send({ type: 'checks.record', taskId, results: PASSING });
  harness.send({
    type: 'agent.report_review',
    ratings: HIGH_LOW,
    runId: harness.activeRun(taskId).id,
    summary: null,
    findings: [],
  });
  return taskId;
}

function approvedForYou(harness: Harness) {
  const taskId = reviewed(harness);
  const gate = listOpenGates(harness.state, taskId).find((found) => found.autopilotJudging === true);
  if (!gate) throw new Error('No gate waits for Autopilot.');
  harness.send({
    type: 'autopilot.judgment',
    taskId,
    gateId: gate.id,
    verdict: 'act',
    reason: 'Small and clear.',
    reply: null,
    shadow: false,
  });
  return { taskId, gateId: gate.id };
}

function setup() {
  const harness = createHarness();
  harness.send({ type: 'settings.change', patch: { autopilot: { enabled: true, autoMerge: 'off' } } });
  return harness;
}

describe('what Autopilot did for you', () => {
  test('lists each gate it answered, newest first, with its reason', () => {
    const harness = setup();
    const first = approvedForYou(harness);
    const second = approvedForYou(harness);
    expect(listAutopilotDone(harness.state)).toEqual([
      {
        gateId: second.gateId,
        taskId: second.taskId,
        gate: 'review',
        action: 'approved',
        title: harness.state.gates[second.gateId]?.title,
        reason: 'Small and clear.',
        followUp: null,
        at: harness.state.gates[second.gateId]?.answeredAt,
      },
      expect.objectContaining({ gateId: first.gateId, gate: 'review' }),
    ]);
  });

  test('keeps the words of a follow-up it sent for you', () => {
    const harness = setup();
    const taskId = reviewed(harness);
    const gate = listOpenGates(harness.state, taskId).find((found) => found.autopilotJudging === true);
    if (!gate) throw new Error('No gate waits for Autopilot.');
    harness.send({
      type: 'autopilot.judgment',
      taskId,
      gateId: gate.id,
      verdict: 'revise',
      reason: 'They always ask about auth.',
      reply: 'How does this handle auth on the new endpoint?',
      shadow: false,
    });
    expect(listAutopilotDone(harness.state)).toEqual([
      expect.objectContaining({
        gateId: gate.id,
        reason: 'They always ask about auth.',
        followUp: 'How does this handle auth on the new endpoint?',
      }),
    ]);
  });

  test('leaves out what you decided yourself and what is still open', () => {
    const harness = createHarness();
    const taskId = reviewed(harness);
    expect(listAutopilotDone(harness.state)).toEqual([]);
    harness.send({
      type: 'gate.answer',
      gateId: harness.openGate(taskId).id,
      decision: 'approve',
      response: null,
    });
    expect(listAutopilotDone(harness.state)).toEqual([]);
  });

  test('drops a gate once you mark it seen, ignoring gates that were not done for you', () => {
    const harness = setup();
    const { gateId } = approvedForYou(harness);
    const other = approvedForYou(harness);
    harness.send({ type: 'autopilot.seen', gateIds: [gateId, gateId, 'gone'] });
    expect(harness.state.gates[gateId]?.autopilotSeen).toBe(true);
    expect(listAutopilotDone(harness.state).map((done) => done.gateId)).toEqual([other.gateId]);
    expect(harness.send({ type: 'autopilot.seen', gateIds: [gateId] }).events).toEqual([]);
  });

  test('is yours alone to mark seen', () => {
    const harness = setup();
    const { gateId } = approvedForYou(harness);
    expect(() => harness.send({ type: 'autopilot.seen', gateIds: [gateId] }, { onBehalf: true })).toThrow(
      'Only you mark what Autopilot did for you as seen.'
    );
  });

  test('forgets a gate whose task is gone, and keeps the newest when there are many', () => {
    const harness = setup();
    const { gateId, taskId } = approvedForYou(harness);
    const state = { ...harness.state, tasks: { ...harness.state.tasks } };
    delete state.tasks[taskId];
    expect(listAutopilotDone(state)).toEqual([]);
    const gate = harness.state.gates[gateId];
    if (!gate) throw new Error('No gate.');
    const gates = Object.fromEntries(
      Array.from({ length: AUTOPILOT_DONE_LIMIT + 1 }, (_, index) => [
        `g${index}`,
        { ...gate, id: `g${index}`, answeredAt: index },
      ])
    );
    const many = listAutopilotDone({ ...harness.state, gates });
    expect(many).toHaveLength(AUTOPILOT_DONE_LIMIT);
    expect(many[0]?.gateId).toBe(`g${AUTOPILOT_DONE_LIMIT}`);
  });
});
