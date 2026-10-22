import { describe, expect, test } from 'bun:test';
import { listActiveRuns, listOpenGates, resolveLiveness } from '../../src/index.ts';
import {
  buildAll,
  completePhase,
  createHarness,
  createTask,
  linkSession,
  PASSING,
  proposePlan,
  reachReviewGate,
  SPEC,
} from '../harness.ts';

describe('planning', () => {
  test('every task starts with a planner on the planner model', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const run = harness.activeRun(taskId);
    expect(harness.task(taskId).stage).toBe('planning');
    expect(run.role).toBe('planner');
    expect(run.model).toBe('opus');
    expect(run.status).toBe('running');
    expect(harness.lastEffect('run.execute').runId).toBe(run.id);
  });

  test('agent models come from settings per role', () => {
    const harness = createHarness();
    harness.send({
      type: 'settings.change',
      patch: { agentModels: { planner: 'fable', builder: 'sonnet' } },
    });
    const taskId = createTask(harness);
    expect(harness.activeRun(taskId).model).toBe('fable');
    proposePlan(harness, taskId);
    expect(harness.activeRun(taskId).model).toBe('sonnet');
  });

  test('a plan goes straight to phase one when plans need no approval', () => {
    const harness = createHarness();
    const taskId = createTask(harness, { size: 'large' });
    proposePlan(harness, taskId);
    const task = harness.task(taskId);
    expect(task.stage).toBe('building');
    expect(task.stageReason).toBe('phase 1 of 2: Find the overflow');
    expect(task.phases.map((phase) => phase.status)).toEqual(['active', 'pending']);
    expect(listOpenGates(harness.state)).toHaveLength(0);
  });

  test('with plan approval on, a large plan waits at the plan gate and approving starts phase one', () => {
    const harness = createHarness();
    harness.send({ type: 'settings.change', patch: { approvePlans: true } });
    const taskId = createTask(harness, { size: 'large' });
    proposePlan(harness, taskId);
    expect(harness.task(taskId).stage).toBe('awaiting_spec');
    const gate = harness.openGate(taskId);
    expect(gate.kind).toBe('spec');
    harness.send({ type: 'gate.answer', gateId: gate.id, decision: 'approve', response: 'Use option B.' });
    expect(harness.task(taskId).stage).toBe('building');
    expect(harness.task(taskId).specAnswers).toBe('Use option B.');
    expect(harness.activeRun(taskId).prompt).toContain('The human answered:\nUse option B.');
  });

  test('a small plan never waits even with plan approval on', () => {
    const harness = createHarness();
    harness.send({ type: 'settings.change', patch: { approvePlans: true } });
    const taskId = createTask(harness, { size: 'small' });
    proposePlan(harness, taskId);
    expect(harness.task(taskId).stage).toBe('building');
  });

  test('revising the plan resumes the planner session with the feedback', () => {
    const harness = createHarness();
    harness.send({ type: 'settings.change', patch: { approvePlans: true } });
    const taskId = createTask(harness, { size: 'large' });
    linkSession(harness, taskId, 'planner-session');
    proposePlan(harness, taskId);
    harness.send({
      type: 'gate.answer',
      gateId: harness.openGate(taskId).id,
      decision: 'revise',
      response: 'Smaller.',
    });
    const run = harness.activeRun(taskId);
    expect(run.role).toBe('planner');
    expect(run.sessionId).toBe('planner-session');
    expect(run.resume).toBe(true);
    expect(run.prompt).toContain('Feedback on the previous plan:\nSmaller.');
  });
});

describe('phases', () => {
  test('each phase gets its own builder that sees the earlier phase summaries', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    proposePlan(harness, taskId);
    const first = harness.activeRun(taskId);
    expect(first.phaseIndex).toBe(0);
    expect(first.prompt).toContain('Your phase: Find the overflow.');
    completePhase(harness, taskId, 'The `TabGroup` container scrolls, not the list.');

    const second = harness.activeRun(taskId);
    expect(second.id).not.toBe(first.id);
    expect(second.phaseIndex).toBe(1);
    expect(second.resume).toBe(false);
    expect(second.prompt).toContain('- Find the overflow: The `TabGroup` container scrolls, not the list.');
    expect(second.prompt).toContain('This is the last phase');
    expect(harness.task(taskId).phases.map((phase) => phase.status)).toEqual(['done', 'active']);
  });

  test('after the last phase Shinsa runs the checks itself', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    buildAll(harness, taskId);
    const task = harness.task(taskId);
    expect(task.stage).toBe('checking');
    expect(listActiveRuns(harness.state, taskId)).toHaveLength(0);
    expect(harness.lastEffect('checks.run')).toEqual({ kind: 'checks.run', taskId, round: 0 });
    expect(resolveLiveness(harness.state, task)).toBe('system');
  });

  test('a plan without phases is built as one phase', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    proposePlan(harness, taskId, { ...SPEC, plan: [] });
    completePhase(harness, taskId);
    expect(harness.task(taskId).stage).toBe('checking');
  });

  test('the review gate carries one report assembled from every phase', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachReviewGate(harness, taskId);
    const task = harness.task(taskId);
    expect(task.stage).toBe('awaiting_review');
    expect(task.report?.phases.map((phase) => phase.title)).toEqual(['Find the overflow', 'Fix and verify']);
    expect(task.report?.phases.map((phase) => phase.summary)).toEqual(['Phase 1 done.', 'Phase 2 done.']);
    expect(task.report?.checks).toEqual(PASSING);
    expect(harness.openGate(taskId).kind).toBe('review');
  });
});
