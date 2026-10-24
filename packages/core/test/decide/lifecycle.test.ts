import { describe, expect, test } from 'bun:test';
import { isTaskLive } from '../../src/decide/liveness.ts';
import { listActiveRuns, listOpenGates, PLAN_GATE_RULE, type PlanGateReason } from '../../src/index.ts';
import {
  buildAll,
  completePhase,
  createHarness,
  createTask,
  type Harness,
  linkSession,
  PASSING,
  PLAN,
  proposePlan,
  reachReviewGate,
  readyWorktree,
} from '../harness.ts';

function withApproval(approvePlans: boolean) {
  const harness = createHarness();
  harness.send({ type: 'settings.change', patch: { approvePlans } });
  return harness;
}

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

  test('the plan gate rule decides which plans wait for you, with Approve plans on and off', () => {
    const reach: Record<PlanGateReason, (approvePlans: boolean) => { harness: Harness; taskId: string }> = {
      operates: (approvePlans) => {
        const harness = withApproval(approvePlans);
        const taskId = createTask(harness);
        harness.send({
          type: 'agent.reshape',
          runId: harness.activeRun(taskId).id,
          steps: ['plan', 'operate'],
          reason: 'Run it.',
        });
        readyWorktree(harness, taskId);
        proposePlan(harness, taskId);
        return { harness, taskId };
      },
      plan_first: (approvePlans) => {
        const harness = withApproval(approvePlans);
        const taskId = createTask(harness, { planFirst: true });
        proposePlan(harness, taskId);
        return { harness, taskId };
      },
      asks_approval: (approvePlans) => {
        const harness = withApproval(approvePlans);
        const taskId = createTask(harness);
        proposePlan(harness, taskId, { ...PLAN, approval: true });
        return { harness, taskId };
      },
      large: (approvePlans) => {
        const harness = withApproval(approvePlans);
        const taskId = createTask(harness, { size: 'large' });
        proposePlan(harness, taskId);
        return { harness, taskId };
      },
      revised: (approvePlans) => {
        const harness = withApproval(approvePlans);
        const taskId = createTask(harness);
        proposePlan(harness, taskId, { ...PLAN, approval: true });
        const gateId = harness.openGate(taskId).id;
        harness.send({ type: 'gate.answer', gateId, decision: 'revise', response: 'Plan it again.' });
        proposePlan(harness, taskId);
        return { harness, taskId };
      },
    };
    for (const reason of [...PLAN_GATE_RULE.always, ...PLAN_GATE_RULE.withApprovePlans]) {
      for (const approvePlans of [true, false]) {
        const { harness, taskId } = reach[reason](approvePlans);
        const waits = PLAN_GATE_RULE.always.includes(reason) || approvePlans;
        expect(harness.task(taskId).stage, `${reason} with Approve plans ${approvePlans}`).toBe(
          waits ? 'awaiting_plan' : 'building'
        );
      }
    }
    const plain = withApproval(true);
    const taskId = createTask(plain);
    proposePlan(plain, taskId);
    expect(plain.task(taskId).stage).toBe('building');
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
    expect(harness.task(taskId).stage).toBe('awaiting_plan');
    const gate = harness.openGate(taskId);
    expect(gate.type).toBe('plan');
    harness.send({ type: 'gate.answer', gateId: gate.id, decision: 'approve', response: 'Use option B.' });
    expect(harness.task(taskId).stage).toBe('building');
    expect(harness.task(taskId).planAnswers).toBe('Use option B.');
    expect(harness.activeRun(taskId).prompt).toContain('The human answered:\nUse option B.');
  });

  test('a task created plan first waits at the plan gate even with plan approval off', () => {
    const harness = createHarness();
    const taskId = createTask(harness, { size: 'small', planFirst: true });
    proposePlan(harness, taskId);
    expect(harness.task(taskId).stage).toBe('awaiting_plan');
    expect(harness.openGate(taskId).type).toBe('plan');
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
    expect(isTaskLive(harness.state, task)).toBe(true);
  });

  test('a plan without phases is built as one phase', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    proposePlan(harness, taskId, { ...PLAN, phases: [] });
    completePhase(harness, taskId);
    expect(harness.task(taskId).stage).toBe('checking');
  });

  test('the review gate carries one report assembled from every phase', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachReviewGate(harness, taskId);
    const task = harness.task(taskId);
    expect(task.stage).toBe('awaiting_review');
    expect(task.report?.sections.map((section) => section.title)).toEqual([
      'Find the overflow',
      'Fix and verify',
    ]);
    expect(task.report?.sections.map((section) => section.summary)).toEqual([
      'Phase 1 done.',
      'Phase 2 done.',
    ]);
    expect(task.report?.checks).toEqual(PASSING);
    expect(harness.openGate(taskId).type).toBe('review');
  });
});
