import { describe, expect, test } from 'bun:test';
import { Option } from 'effect';
import {
  AUTOPILOT_FEATURE_COUNT,
  isAutopilotPositive,
  listAutopilotFeatures,
  listAutopilotSegmentKeys,
  resolveFeatureHash,
} from '../../src/autopilot/model/index.ts';
import {
  AUTOPILOT_MODEL_LIMITS,
  AUTOPILOT_PROFILE_LIMITS,
  applyEvent,
  type AutopilotDecision,
  type AutopilotDecisionFacts,
  type AutopilotModel,
  createAutopilotModel,
  createState,
  learnAutopilotDecisions,
  selectAutopilotModelGuess,
  serializeState,
} from '../../src/index.ts';
import { createHarness, createTask, PLAN, proposePlan } from '../harness.ts';

const FACTS: AutopilotDecisionFacts = {
  confidence: 'high',
  shape: 'change',
  repoId: 'repo',
  revisions: 1,
  findings: { blocking: 0, shouldFix: 1, optional: 2 },
  heldPlan: false,
  waitedMinutes: 30,
  active: false,
  inHours: true,
  hour: 22,
};

function decision(overrides: Partial<AutopilotDecision> = {}): AutopilotDecision {
  return {
    at: 1,
    taskId: 't',
    gateId: 'g',
    kind: 'review',
    answer: 'approved',
    projectId: 'p1',
    risk: 'low',
    scope: { phases: 2, files: 3 },
    urgent: false,
    watchdog: false,
    touched: false,
    guess: null,
    followUp: null,
    note: null,
    facts: FACTS,
    estimate: null,
    ...overrides,
  };
}

function repeat(count: number, overrides: Partial<AutopilotDecision>) {
  return Array.from({ length: count }, (_, index) => decision({ at: index, ...overrides }));
}

function guess(model: AutopilotModel, overrides: Partial<AutopilotDecision> = {}) {
  return Option.getOrThrow(selectAutopilotModelGuess(model, decision(overrides)));
}

describe('the features of a decision', () => {
  test('stay inside the layout and carry the facts the gate knew', () => {
    const features = listAutopilotFeatures(decision({ watchdog: true }));
    expect(features[0]).toEqual({ index: 0, value: 1 });
    expect(features.every((feature) => feature.index >= 0 && feature.index < AUTOPILOT_FEATURE_COUNT)).toBe(
      true
    );
    expect(new Set(features.map((feature) => feature.index)).size).toBe(features.length);
    expect(features.length).toBeGreaterThan(
      listAutopilotFeatures(decision({ facts: null, scope: null })).length
    );
  });

  test('hash a project to the same bucket every time', () => {
    expect(resolveFeatureHash('p1')).toBe(resolveFeatureHash('p1'));
    expect(resolveFeatureHash('p1')).toBeLessThan(AUTOPILOT_MODEL_LIMITS.hashBuckets);
  });

  test('read a decision recorded before its facts were', () => {
    const features = listAutopilotFeatures(
      decision({ facts: null, projectId: null, risk: null, scope: null, kind: 'message', answer: 'sent' })
    );
    expect(features.length).toBeGreaterThan(1);
  });
});

describe('the model', () => {
  test('guesses only the decisions a head learns, and knows nothing at first', () => {
    const model = createAutopilotModel();
    expect(
      Option.isNone(selectAutopilotModelGuess(model, decision({ kind: 'message', answer: 'sent' })))
    ).toBe(true);
    expect(guess(model)).toEqual({ head: 'gate', p: 0.5, confidence: 0, similar: 0 });
    expect(guess(model, { kind: 'finding', answer: 'fixed' }).head).toBe('finding');
    expect(Option.getOrThrow(selectAutopilotModelGuess(undefined, decision())).p).toBe(0.5);
  });

  test('guesses before it learns, so each stored guess never saw its own answer', () => {
    const { learned } = learnAutopilotDecisions(undefined, repeat(3, { answer: 'approved' }));
    expect(learned[0]?.modelGuess).toEqual({ head: 'gate', p: 0.5, confidence: 0, similar: 0 });
    expect(learned[1]?.modelGuess?.p).toBeGreaterThan(0.5);
    expect(learned[2]?.modelGuess?.similar).toBeGreaterThan(learned[1]?.modelGuess?.similar ?? 0);
    const { learned: steering } = learnAutopilotDecisions(undefined, [
      decision({ kind: 'edit', answer: 'edited' }),
    ]);
    expect(steering[0]?.modelGuess).toBeNull();
  });

  test('learns what you approve, and grows sure only after enough decisions like it', () => {
    const early = learnAutopilotDecisions(undefined, repeat(5, { answer: 'approved' })).model;
    expect(guess(early).confidence).toBeLessThan(0.15);
    const { model } = learnAutopilotDecisions(undefined, repeat(80, { answer: 'approved' }));
    expect(guess(model).p).toBeGreaterThan(0.9);
    expect(guess(model).confidence).toBeGreaterThan(0.7);
  });

  test('tells apart what it should, from risk and the reviewer together', () => {
    const mixed = Array.from({ length: 200 }, (_, index) =>
      index % 2
        ? decision({ at: index, risk: 'low', answer: 'approved' })
        : decision({ at: index, risk: 'high', answer: 'revised' })
    );
    const { model } = learnAutopilotDecisions(undefined, mixed);
    expect(guess(model, { risk: 'low' }).p).toBeGreaterThan(0.75);
    expect(guess(model, { risk: 'high' }).p).toBeLessThan(0.25);
  });

  test('counts recent decisions most, so a change in how you decide wins', () => {
    const { model } = learnAutopilotDecisions(undefined, [
      ...repeat(150, { answer: 'approved' }),
      ...repeat(150, { answer: 'revised' }),
    ]);
    expect(guess(model).p).toBeLessThan(0.3);
  });

  test('backs off to the gate kind for a project it has not seen', () => {
    const { model } = learnAutopilotDecisions(undefined, repeat(30, { answer: 'approved' }));
    const known = guess(model);
    const fresh = guess(model, { projectId: 'p2', risk: 'high' });
    expect(fresh.similar).toBe(known.similar);
    expect(listAutopilotSegmentKeys('gate', decision())).toEqual([
      'gate|review|p1|low',
      'gate|review|p1|',
      'gate|review||low',
      'gate|review||',
    ]);
    expect(listAutopilotSegmentKeys('gate', decision({ projectId: null, risk: null }))).toEqual([
      'gate|review||',
    ]);
    const lone = learnAutopilotDecisions(undefined, [decision({ projectId: null, risk: null })]).model;
    expect(guess(lone, { projectId: null, risk: null }).similar).toBe(1);
    const sparse = learnAutopilotDecisions(undefined, repeat(2, { answer: 'approved' })).model;
    expect(guess(sparse, { projectId: 'p2' }).similar).toBeLessThan(AUTOPILOT_MODEL_LIMITS.segmentMinimum);
  });

  test('keeps a head to its own decisions', () => {
    const { model } = learnAutopilotDecisions(
      undefined,
      repeat(60, { kind: 'finding', answer: 'dismissed' })
    );
    expect(guess(model, { kind: 'finding', answer: 'fixed' }).p).toBeLessThan(0.2);
    expect(guess(model).p).toBe(0.5);
    expect(model.heads.gate.seen).toBe(0);
    expect(isAutopilotPositive('suggestion', decision({ kind: 'suggestion', answer: 'kept' }))).toBe(true);
  });

  test('learns a retry with your guidance as a retry, and a cancel as its opposite', () => {
    expect(isAutopilotPositive('gate', decision({ kind: 'failure', answer: 'replied' }))).toBe(true);
    expect(isAutopilotPositive('gate', decision({ kind: 'failure', answer: 'rejected' }))).toBe(false);
  });

  test('comes out the same whether it learns all at once or one decision at a time', () => {
    const all = Array.from({ length: 120 }, (_, index) =>
      decision({ at: index, risk: index % 3 ? 'low' : 'medium', answer: index % 4 ? 'approved' : 'revised' })
    );
    const once = learnAutopilotDecisions(undefined, all);
    let model: AutopilotModel | undefined;
    const learned = [];
    for (const entry of all) {
      const step = learnAutopilotDecisions(model, [entry]);
      model = step.model;
      learned.push(...step.learned);
    }
    expect(model).toEqual(once.model);
    expect(learned).toEqual(once.learned);
  });
});

describe('the model in state', () => {
  function decideSome() {
    const harness = createHarness();
    for (let index = 0; index < 3; index += 1) {
      const taskId = createTask(harness);
      proposePlan(harness, taskId, { ...PLAN, approval: true });
      harness.send({
        type: 'gate.answer',
        gateId: harness.openGate(taskId).id,
        decision: 'approve',
        response: null,
      });
    }
    return harness;
  }

  test('learns every decision you make and keeps each one, guessed first', () => {
    const harness = decideSome();
    const plans = (harness.state.autopilotHistory ?? []).filter((entry) => entry.kind === 'plan');
    expect(plans).toHaveLength(3);
    expect(plans[0]?.modelGuess?.p).toBe(0.5);
    expect(plans[2]?.modelGuess?.p).toBeGreaterThan(0.5);
    expect(harness.state.autopilotModel?.heads.gate.seen).toBe(3);
    expect(harness.state.autopilotHistory?.length).toBe(harness.state.autopilotProfile.total);
  });

  test('is rebuilt exactly when the log is replayed', () => {
    const first = decideSome();
    const second = decideSome();
    expect(second.state.autopilotModel).toEqual(first.state.autopilotModel);
    expect(second.state.autopilotHistory?.map((entry) => entry.modelGuess)).toEqual(
      first.state.autopilotHistory?.map((entry) => entry.modelGuess)
    );
  });

  test('keeps every decision ever made, past the profile it shows', () => {
    const many = repeat(AUTOPILOT_PROFILE_LIMITS.words + 50, { answer: 'approved' });
    const state = applyEvent(createState(), { type: 'autopilot.decided', decisions: many, seq: 1, at: 1 });
    expect(state.autopilotHistory).toHaveLength(many.length);
    expect(state.autopilotProfile.decisions).toHaveLength(AUTOPILOT_PROFILE_LIMITS.words);
    expect(state.autopilotModel?.heads.gate.seen).toBe(many.length);
  });

  test('stays on this machine: the page is never sent it', () => {
    const harness = decideSome();
    expect(Object.keys(serializeState(harness.state))).not.toContain('autopilotModel');
    expect(Object.keys(serializeState(harness.state))).not.toContain('autopilotHistory');
  });
});
