import { describe, expect, test } from 'bun:test';
import {
  AUTOPILOT_AREA_LIMITS,
  AUTOPILOT_DEFAULTS,
  type AutopilotAgreement,
  type AutopilotDecision,
  type AutopilotDecisionFacts,
  type AutopilotKindProfile,
  type AutopilotPolicy,
  EMPTY_AUTOPILOT_PROFILE,
  listAutopilotAreaReadiness,
  recordAutopilotDecisions,
  resolveAutopilotFacts,
  resolveAutopilotFindingLimit,
  resolveAutopilotLimits,
} from '../../src/index.ts';
import { createHarness, createTask, PLAN, proposePlan } from '../harness.ts';

const AREA = 'apps/web/projects';

const EVERYTHING: AutopilotPolicy = {
  ...AUTOPILOT_DEFAULTS,
  enabled: true,
  level: 'everything',
  autoMerge: 'approved',
  gates: [...AUTOPILOT_DEFAULTS.gates, 'failures', 'findings'],
};

const FACTS: AutopilotDecisionFacts = {
  confidence: 'high',
  shape: 'change',
  repoId: null,
  revisions: 0,
  findings: { blocking: 0, shouldFix: 0, optional: 0 },
  heldPlan: false,
  waitedMinutes: 1,
  active: true,
  inHours: null,
  hour: 10,
  work: { area: AREA, surface: 'ui', novelty: 'tweak', size: 'small', terms: [] },
};

function decision(overrides: Partial<AutopilotDecision>): AutopilotDecision {
  return {
    at: 1,
    taskId: 't',
    gateId: 'g',
    kind: 'plan',
    answer: 'approved',
    projectId: null,
    risk: 'low',
    scope: { phases: 2, files: 2 },
    urgent: false,
    watchdog: false,
    touched: false,
    guess: 'act',
    followUp: null,
    note: null,
    facts: FACTS,
    estimate: null,
    ...overrides,
  };
}

function agreement(scored: number, agreed: number, base: number): AutopilotAgreement {
  return { scored, agreed, weight: scored, agreedWeight: agreed, baseWeight: base, loss: 0 };
}

function area(scored: number, agreed: number, base: number): AutopilotKindProfile {
  const track = agreement(scored, agreed, base);
  return {
    tracks: { model: track, call: track, combined: track, base: agreement(scored, base, base) },
    rate: { positive: 1, negative: 1 },
  };
}

const READY_KIND = area(120, 118, 60);

function profile(areas: Record<string, AutopilotKindProfile>) {
  return {
    ...EMPTY_AUTOPILOT_PROFILE,
    kinds: { plan: READY_KIND, review: READY_KIND, finding: READY_KIND },
    areas,
  };
}

function reachPlan(request: string) {
  const harness = createHarness();
  harness.send({ type: 'settings.change', patch: { approvePlans: 'always' } });
  const taskId = createTask(harness, { request });
  proposePlan(harness, taskId, {
    ...PLAN,
    files: [{ path: 'apps/web/src/components/projects/delete-dialog.tsx', change: 'Add the dialog.' }],
  });
  return { harness, task: harness.task(taskId) };
}

describe('readiness per area of the app', () => {
  test('each scored decision also counts toward the area of its work', () => {
    const recorded = recordAutopilotDecisions(undefined, [
      decision({}),
      decision({ answer: 'rejected' }),
      decision({ facts: { ...FACTS, work: null } }),
      decision({ facts: null }),
      decision({ kind: 'message', answer: 'sent', guess: null }),
    ]);
    expect(Object.keys(recorded.areas)).toEqual([AREA]);
    expect(recorded.areas[AREA]?.tracks.combined).toMatchObject({ scored: 2, agreed: 1 });
    expect(recorded.kinds.plan?.tracks.combined.scored).toBe(4);
  });

  test('lists each area with its score, whether it is known and whether it is ready', () => {
    const state = {
      autopilotProfile: profile({
        'apps/web/settings': area(40, 39, 20),
        'apps/engine/runtime': area(AUTOPILOT_AREA_LIMITS.minScored, 20, 20),
        'packages/core/decide': area(5, 5, 5),
        'docs/engine': area(0, 0, 0),
      }),
    };
    expect(
      listAutopilotAreaReadiness(state).map(({ area: name, known, ready, score }) => ({
        name,
        known,
        ready,
        scored: score.scored,
      }))
    ).toEqual([
      { name: 'apps/web/settings', known: true, ready: true, scored: 40 },
      { name: 'apps/engine/runtime', known: true, ready: false, scored: 30 },
      { name: 'packages/core/decide', known: false, ready: false, scored: 5 },
    ]);
    expect(listAutopilotAreaReadiness({ autopilotProfile: EMPTY_AUTOPILOT_PROFILE })).toEqual([]);
  });

  test('an area that agrees often but no better than your usual answer is not ready', () => {
    const state = { autopilotProfile: profile({ [AREA]: area(50, 48, 48) }) };
    expect(listAutopilotAreaReadiness(state)[0]).toMatchObject({ known: true, ready: false });
  });

  test('at Everything, a known area below the bar holds a ready kind’s gate for you, naming the area', () => {
    const { harness, task } = reachPlan('Add a small confirm dialog before deleting a project.');
    const held = { ...harness.state, autopilotProfile: profile({ [AREA]: area(40, 20, 20) }) };
    const facts = resolveAutopilotFacts(held, task, 'review', harness.now, harness.now);
    expect(facts).toMatchObject({ ready: true, heldArea: AREA });
    const limits = resolveAutopilotLimits(
      { ...facts, confidence: 'high', risk: 'high', scope: { phases: 7, files: 30 } },
      EVERYTHING
    );
    expect(limits.act).toEqual({
      allowed: false,
      reason: `Autopilot does not know how you handle work in ${AREA} well enough yet, so it waits for you.`,
      setting: false,
    });
  });

  test('a held area still acts where Most things would', () => {
    const { harness, task } = reachPlan('Add a small confirm dialog before deleting a project.');
    const held = { ...harness.state, autopilotProfile: profile({ [AREA]: area(40, 20, 20) }) };
    const facts = resolveAutopilotFacts(held, task, 'review', harness.now, harness.now);
    const low = { ...facts, confidence: 'high' as const, risk: 'low' as const };
    expect(resolveAutopilotLimits(low, EVERYTHING).act).toEqual({ allowed: true });
    const unrated = { ...facts, confidence: null, risk: null };
    expect(resolveAutopilotLimits(unrated, EVERYTHING).act).toMatchObject({
      reason: 'The reviewer did not rate the change.',
    });
  });

  test('an area still learning, or one that is ready, never holds the gate', () => {
    const { harness, task } = reachPlan('Add a small confirm dialog before deleting a project.');
    const cases: Record<string, AutopilotKindProfile>[] = [
      { [AREA]: area(10, 2, 5) },
      { [AREA]: area(40, 39, 20) },
      {},
    ];
    for (const areas of cases) {
      const state = { ...harness.state, autopilotProfile: profile(areas) };
      expect(resolveAutopilotFacts(state, task, 'plan', harness.now, harness.now).heldArea).toBeNull();
    }
    const state = { ...harness.state, autopilotProfile: profile({ [AREA]: area(40, 20, 20) }) };
    expect(resolveAutopilotFacts(state, task, 'question', harness.now, harness.now).heldArea).toBeNull();
  });

  test('review findings in a held area wait for you, naming the area', () => {
    const { harness, task } = reachPlan('Add a small confirm dialog before deleting a project.');
    const held = { autopilotProfile: profile({ [AREA]: area(40, 20, 20) }) };
    expect(resolveAutopilotFindingLimit(held, EVERYTHING, task)).toEqual({
      allowed: false,
      reason: `Autopilot does not know how you handle work in ${AREA} well enough yet, so it waits for you.`,
      setting: false,
    });
    expect(resolveAutopilotFindingLimit({ autopilotProfile: profile({}) }, EVERYTHING, task)).toEqual({
      allowed: true,
    });
    expect(harness.state.tasks[task.id]).toBeDefined();
  });
});
