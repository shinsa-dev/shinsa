import { describe, expect, test } from 'bun:test';
import { listActiveRuns, listOpenGates } from '../../src/index.ts';
import { completePhase, createHarness, createTask, linkSession, proposePlan } from '../harness.ts';

describe('recovery', () => {
  test('an agent that ends without handing over is resumed once with a nudge', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    linkSession(harness, taskId, 'plan-1');
    const first = harness.activeRun(taskId);
    harness.send({ type: 'run.end', runId: first.id, outcome: 'completed', summary: null });
    const second = harness.activeRun(taskId);
    expect(second.role).toBe('planner');
    expect(second.sessionId).toBe('plan-1');
    expect(second.prompt).toContain('ended its turn without calling the hand-over tool');
    expect(harness.task(taskId).recoveries).toBe(1);
  });

  test('a second stop opens a failure gate, and retry starts the step again', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    proposePlan(harness, taskId);
    harness.send({
      type: 'run.end',
      runId: harness.activeRun(taskId).id,
      outcome: 'failed',
      summary: 'Overloaded',
    });
    harness.send({
      type: 'run.end',
      runId: harness.activeRun(taskId).id,
      outcome: 'failed',
      summary: 'Overloaded',
    });
    const gate = harness.openGate(taskId);
    expect(gate.purpose).toBe('failure');
    expect(gate.title).toBe('The builder paused');
    expect(listActiveRuns(harness.state, taskId)).toHaveLength(0);

    harness.send({ type: 'gate.answer', gateId: gate.id, decision: 'approve', response: null });
    const run = harness.activeRun(taskId);
    expect(run.role).toBe('builder');
    expect(run.phaseIndex).toBe(0);
    expect(harness.task(taskId).recoveries).toBe(0);
  });

  test('progress resets the recovery budget', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({
      type: 'run.end',
      runId: harness.activeRun(taskId).id,
      outcome: 'completed',
      summary: null,
    });
    proposePlan(harness, taskId);
    expect(harness.task(taskId).recoveries).toBe(0);
    harness.send({
      type: 'run.end',
      runId: harness.activeRun(taskId).id,
      outcome: 'completed',
      summary: null,
    });
    expect(harness.activeRun(taskId).role).toBe('builder');
  });

  test('run.end after the agent handed over is ignored', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const planner = harness.activeRun(taskId);
    proposePlan(harness, taskId);
    const builder = harness.activeRun(taskId);
    harness.send({ type: 'run.end', runId: planner.id, outcome: 'failed', summary: 'late' });
    expect(harness.activeRun(taskId).id).toBe(builder.id);
    expect(listOpenGates(harness.state, taskId)).toHaveLength(0);
  });

  test('rejecting a failure gate cancels the task', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({ type: 'effect.fail', taskId, title: 'Worktree failed', detail: 'disk full' });
    harness.send({
      type: 'gate.answer',
      gateId: harness.openGate(taskId).id,
      decision: 'reject',
      response: null,
    });
    expect(harness.task(taskId).stage).toBe('cancelled');
  });
});

describe('links to the chat', () => {
  test('a failure gate points at the run that stopped, and its activity links there too', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    proposePlan(harness, taskId);
    harness.send({
      type: 'run.end',
      runId: harness.activeRun(taskId).id,
      outcome: 'failed',
      summary: 'Overloaded',
    });
    const second = harness.activeRun(taskId);
    harness.send({ type: 'run.end', runId: second.id, outcome: 'failed', summary: 'Overloaded' });
    const gate = harness.openGate(taskId);
    expect(gate.runId).toBe(second.id);
    expect(harness.task(taskId).activity.at(-1)).toMatchObject({ kind: 'failure', runId: second.id });
  });

  test('phase summaries and review results link to the run that wrote them', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    proposePlan(harness, taskId);
    const builder = harness.activeRun(taskId);
    completePhase(harness, taskId, 'Found it.');
    const entry = harness.task(taskId).activity.find((item) => item.detail === 'Found it.');
    expect(entry?.runId).toBe(builder.id);
    expect(harness.task(taskId).phaseReports[0]?.runId).toBe(builder.id);
  });
});
