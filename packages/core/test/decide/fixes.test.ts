import { describe, expect, test } from 'bun:test';
import { listActiveRuns } from '../../src/index.ts';
import {
  buildAll,
  completePhase,
  createHarness,
  createTask,
  failing,
  linkSession,
  PASSING,
  proposePlan,
  reachReviewGate,
} from '../harness.ts';

describe('checks and agent review', () => {
  test('passing checks start an independent reviewer', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    buildAll(harness, taskId);
    harness.send({ type: 'checks.record', taskId, results: PASSING });
    const run = harness.activeRun(taskId);
    expect(harness.task(taskId).stage).toBe('reviewing');
    expect(run.role).toBe('reviewer');
    expect(run.resume).toBe(false);
    expect(run.prompt).toContain('You did not write this code.');
  });

  test('failing checks start a fixer on the builder session with the failure output', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    proposePlan(harness, taskId);
    completePhase(harness, taskId);
    linkSession(harness, taskId, 'builder-2');
    completePhase(harness, taskId);
    harness.send({ type: 'checks.record', taskId, results: failing() });
    const run = harness.activeRun(taskId);
    const task = harness.task(taskId);
    expect(task.stage).toBe('fixing');
    expect(task.fixFor).toBe('checks');
    expect(task.fixRounds).toBe(1);
    expect(run.role).toBe('fixer');
    expect(run.sessionId).toBe('builder-2');
    expect(run.prompt).toContain('src/a.ts(3,1): error TS2322');
  });

  test('a finished fix runs the checks again, then the review', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    buildAll(harness, taskId);
    harness.send({ type: 'checks.record', taskId, results: failing() });
    harness.send({ type: 'agent.complete_fix', runId: harness.activeRun(taskId).id, summary: 'Typed it.' });
    expect(harness.task(taskId).stage).toBe('checking');
    expect(harness.lastEffect('checks.run').round).toBe(1);
    harness.send({ type: 'checks.record', taskId, results: PASSING });
    expect(harness.task(taskId).stage).toBe('reviewing');
  });

  test('blocking findings go to a fixer, then checks and a fresh reviewer', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    buildAll(harness, taskId);
    harness.send({ type: 'checks.record', taskId, results: PASSING });
    const reviewer = harness.activeRun(taskId);
    harness.send({
      type: 'agent.report_review',
      runId: reviewer.id,
      findings: [{ severity: 'blocking', file: 'src/a.ts', line: 3, message: 'Off by one.' }],
    });
    expect(harness.task(taskId).stage).toBe('fixing');
    expect(harness.activeRun(taskId).prompt).toContain('src/a.ts:3: Off by one.');
    harness.send({ type: 'agent.complete_fix', runId: harness.activeRun(taskId).id, summary: 'Fixed.' });
    harness.send({ type: 'checks.record', taskId, results: PASSING });
    const second = harness.activeRun(taskId);
    expect(second.role).toBe('reviewer');
    expect(second.id).not.toBe(reviewer.id);
  });

  test('suggestions alone do not block the review gate', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    buildAll(harness, taskId);
    harness.send({ type: 'checks.record', taskId, results: PASSING });
    harness.send({
      type: 'agent.report_review',
      runId: harness.activeRun(taskId).id,
      findings: [{ severity: 'suggestion', file: null, line: null, message: 'Rename it.' }],
    });
    expect(harness.task(taskId).stage).toBe('awaiting_review');
  });

  test('the same failure twice in a row stops the loop with a failure gate', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    buildAll(harness, taskId);
    for (let round = 0; round < 3; round += 1) {
      harness.send({ type: 'checks.record', taskId, results: failing() });
      if (harness.task(taskId).stage !== 'fixing') break;
      harness.send({ type: 'agent.complete_fix', runId: harness.activeRun(taskId).id, summary: 'Tried.' });
    }
    const gate = harness.openGate(taskId);
    expect(gate.purpose).toBe('failure');
    expect(gate.title).toBe('Fixing is not making progress');
    expect(listActiveRuns(harness.state, taskId)).toHaveLength(0);
  });

  test('a different failure each round keeps fixing until the round cap', () => {
    const harness = createHarness();
    harness.send({ type: 'settings.change', patch: { maxFixRounds: 2 } });
    const taskId = createTask(harness);
    buildAll(harness, taskId);
    harness.send({ type: 'checks.record', taskId, results: failing('a') });
    harness.send({ type: 'agent.complete_fix', runId: harness.activeRun(taskId).id, summary: 'One.' });
    harness.send({ type: 'checks.record', taskId, results: failing('b') });
    harness.send({ type: 'agent.complete_fix', runId: harness.activeRun(taskId).id, summary: 'Two.' });
    harness.send({ type: 'checks.record', taskId, results: failing('c') });
    expect(harness.openGate(taskId).title).toBe('Out of automatic fix rounds');
  });

  test('retrying after a stalled loop gives the agent another go', () => {
    const harness = createHarness();
    harness.send({ type: 'settings.change', patch: { maxFixRounds: 1 } });
    const taskId = createTask(harness);
    buildAll(harness, taskId);
    harness.send({ type: 'checks.record', taskId, results: failing('a') });
    harness.send({ type: 'agent.complete_fix', runId: harness.activeRun(taskId).id, summary: 'One.' });
    harness.send({ type: 'checks.record', taskId, results: failing('b') });
    const gate = harness.openGate(taskId);
    harness.send({
      type: 'gate.answer',
      gateId: gate.id,
      decision: 'approve',
      response: 'Look at the types.',
    });
    expect(harness.task(taskId).stage).toBe('checking');
  });

  test('checks recorded outside the checking stage are ignored', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({ type: 'checks.record', taskId, results: failing() });
    expect(harness.task(taskId).stage).toBe('planning');
    expect(harness.task(taskId).checkResults).toBeNull();
  });
});

describe('fix loop limits', () => {
  test('alternating failures still stop: a failure seen twice before ends the loop', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    buildAll(harness, taskId);
    const finding = (message: string) => ({
      severity: 'blocking' as const,
      file: 'src/a.ts',
      line: 1,
      message,
    });
    for (let round = 0; round < 3; round += 1) {
      harness.send({ type: 'checks.record', taskId, results: failing('lint') });
      if (harness.task(taskId).stage !== 'fixing') break;
      harness.send({ type: 'agent.complete_fix', runId: harness.activeRun(taskId).id, summary: 'x' });
      harness.send({ type: 'checks.record', taskId, results: PASSING });
      harness.send({
        type: 'agent.report_review',
        runId: harness.activeRun(taskId).id,
        findings: [finding(`wording ${round}`)],
      });
      if (harness.task(taskId).stage !== 'fixing') break;
      harness.send({ type: 'agent.complete_fix', runId: harness.activeRun(taskId).id, summary: 'y' });
    }
    expect(harness.openGate(taskId).title).toBe('Fixing is not making progress');
  });

  test('"until clean" still has a ceiling', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    buildAll(harness, taskId);
    for (let round = 0; round < 20; round += 1) {
      harness.send({ type: 'checks.record', taskId, results: failing(`check-${round}`) });
      if (harness.task(taskId).stage !== 'fixing') break;
      harness.send({ type: 'agent.complete_fix', runId: harness.activeRun(taskId).id, summary: 'x' });
    }
    expect(harness.openGate(taskId).title).toBe('Out of automatic fix rounds');
    expect(harness.task(taskId).fixRounds).toBe(12);
  });
});

describe('the automatic fix budget', () => {
  test('retrying after the rounds ran out gives the agent a fresh budget', () => {
    const harness = createHarness();
    harness.send({ type: 'settings.change', patch: { maxFixRounds: 1 } });
    const taskId = createTask(harness);
    buildAll(harness, taskId);
    harness.send({ type: 'checks.record', taskId, results: failing('a') });
    harness.send({ type: 'agent.complete_fix', runId: harness.activeRun(taskId).id, summary: 'One.' });
    harness.send({ type: 'checks.record', taskId, results: failing('b') });
    expect(harness.openGate(taskId).title).toBe('Out of automatic fix rounds');
    harness.send({ type: 'task.retry', taskId });
    harness.send({ type: 'checks.record', taskId, results: failing('b') });
    expect(harness.activeRun(taskId).role).toBe('fixer');
    expect(harness.task(taskId).fixRounds).toBe(1);
  });

  test('retrying after a stalled loop does not stop again on the same failure', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    buildAll(harness, taskId);
    for (let round = 0; round < 3; round += 1) {
      harness.send({ type: 'checks.record', taskId, results: failing() });
      if (harness.task(taskId).stage !== 'fixing') break;
      harness.send({ type: 'agent.complete_fix', runId: harness.activeRun(taskId).id, summary: 'Tried.' });
    }
    expect(harness.openGate(taskId).title).toBe('Fixing is not making progress');
    harness.send({ type: 'task.retry', taskId });
    harness.send({ type: 'checks.record', taskId, results: failing() });
    expect(harness.activeRun(taskId).role).toBe('fixer');
  });

  test('changes you ask for start a fresh budget and do not use it up', () => {
    const harness = createHarness();
    harness.send({ type: 'settings.change', patch: { maxFixRounds: 1 } });
    const taskId = createTask(harness);
    reachReviewGate(harness, taskId);
    harness.send({
      type: 'gate.answer',
      gateId: harness.openGate(taskId).id,
      decision: 'revise',
      response: 'Rename.',
    });
    harness.send({ type: 'agent.complete_fix', runId: harness.activeRun(taskId).id, summary: 'Renamed.' });
    harness.send({ type: 'checks.record', taskId, results: failing() });
    expect(harness.activeRun(taskId).role).toBe('fixer');
  });
});
