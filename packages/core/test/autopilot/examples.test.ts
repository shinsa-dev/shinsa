import { describe, expect, test } from 'bun:test';
import { Option } from 'effect';
import {
  createAutopilotProbe,
  describeAutopilotEstimate,
  listAutopilotExampleLines,
  selectAutopilotEstimate,
} from '../../src/autopilot/examples.ts';
import {
  AUTOPILOT_RETRIEVAL_LIMITS,
  type AutopilotLearnedDecision,
  listAutopilotNeighbours,
  listAutopilotWords,
} from '../../src/autopilot/model/index.ts';
import type { AutopilotDecision, AutopilotDecisionFacts } from '../../src/index.ts';
import { createHarness, createTask, proposePlan } from '../harness.ts';

const FACTS: AutopilotDecisionFacts = {
  confidence: 'high',
  shape: 'change',
  repoId: 'repo',
  revisions: 0,
  findings: { blocking: 0, shouldFix: 0, optional: 0 },
  heldPlan: false,
  waitedMinutes: 10,
  active: true,
  inHours: true,
  hour: 10,
  work: null,
};

function decision(overrides: Partial<AutopilotLearnedDecision> = {}): AutopilotLearnedDecision {
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
    modelGuess: null,
    ...overrides,
  };
}

const NO_TEXT = () => '';

describe('the words of a decision', () => {
  test('are the lower-case words of three letters or more, once each', () => {
    expect([...listAutopilotWords('Fix the Tab tab scroll, v2 ok')]).toEqual(['fix', 'the', 'tab', 'scroll']);
    expect(listAutopilotWords('')).toEqual(new Set());
  });
});

describe('the nearest earlier decisions', () => {
  test('keep to the same kind and leave out the gate being judged', () => {
    const history = [decision({ kind: 'merge' }), decision({ gateId: 'now' }), decision({ gateId: 'old' })];
    const found = listAutopilotNeighbours(history, decision({ gateId: 'now' }), '', NO_TEXT);
    expect(found.map((entry) => entry.decision.gateId)).toEqual(['old']);
  });

  test('rank the decision most like this one first, by its facts', () => {
    const near = decision({ gateId: 'near' });
    const far = decision({ gateId: 'far', risk: 'high', scope: { phases: 9, files: 40 }, urgent: true });
    const found = listAutopilotNeighbours([near, far], decision({ gateId: 'now' }), '', NO_TEXT);
    expect(found.map((entry) => entry.decision.gateId)).toEqual(['near', 'far']);
    expect(found[0]?.similarity).toBeGreaterThan(found[1]?.similarity ?? 1);
  });

  test('rank shared words above recency when the facts are the same', () => {
    const worded = decision({ gateId: 'worded', note: 'scroll container' });
    const recent = decision({ gateId: 'recent', note: 'billing' });
    const found = listAutopilotNeighbours(
      [worded, recent],
      decision({ gateId: 'now' }),
      'Fix the scroll container',
      (entry) => entry.note ?? ''
    );
    expect(found.map((entry) => entry.decision.gateId)).toEqual(['worded', 'recent']);
  });

  test('prefer the more recent of two equal decisions, and keep at most a few', () => {
    const history = Array.from({ length: 20 }, (_, index) => decision({ gateId: `g${index}` }));
    const found = listAutopilotNeighbours(history, decision({ gateId: 'now' }), '', NO_TEXT);
    expect(found).toHaveLength(AUTOPILOT_RETRIEVAL_LIMITS.examples);
    expect(found[0]?.decision.gateId).toBe('g19');
  });
});

describe('the estimate line', () => {
  test('says how sure the model is, and to weigh it lightly while it learns', () => {
    const sure = { head: 'gate' as const, p: 0.934, confidence: 0.8, similar: 41.2 };
    expect(describeAutopilotEstimate(sure)).toBe(
      'Their personal model, learned from every decision they made: 93% that they approve this, from 41 similar decisions.'
    );
    expect(describeAutopilotEstimate({ ...sure, confidence: 0.1 })).toEndWith(
      'It is still learning, so weigh it lightly.'
    );
  });
});

function planHarness() {
  const harness = createHarness();
  harness.send({ type: 'settings.change', patch: { approvePlans: 'always' } });
  const taskId = createTask(harness);
  proposePlan(harness, taskId);
  return { harness, taskId, gate: harness.openGate(taskId) };
}

describe('the worked examples for a judgment', () => {
  test('describe each earlier decision with its facts, its answer and your words', () => {
    const { harness, taskId, gate } = planHarness();
    const base = { ...decision(), kind: 'plan' as const, taskId };
    const decisions: AutopilotDecision[] = [
      { ...base, gateId: 'a', answer: 'approved', urgent: true, watchdog: true, note: 'Fine.' },
      { ...base, gateId: 'b', answer: 'revised', facts: { ...FACTS, active: false, confidence: null } },
      { ...base, gateId: 'c', taskId: 'gone', answer: 'rejected', risk: null, scope: null, facts: null },
    ];
    harness.replay({ type: 'autopilot.decided', decisions });
    const title = harness.task(taskId).title;
    const lines = listAutopilotExampleLines(harness.state, harness.task(taskId), gate, 'plan', harness.now);
    expect(lines).toContain(
      `- A plan on “${title}” (low risk, 2 phases, 3 files, reviewer confidence high, urgent, filed by a watchdog, they were active): they approved it. They wrote: “Fine.”`
    );
    expect(lines).toContain(
      `- A plan on “${title}” (low risk, 2 phases, 3 files, they were away): they asked for changes.`
    );
    expect(lines).toContain('- A plan: they rejected it.');
  });

  test('stay inside their budget', () => {
    const { harness, taskId, gate } = planHarness();
    const note = 'x'.repeat(270);
    const decisions = Array.from({ length: 12 }, (_, index) => ({
      ...decision(),
      kind: 'plan' as const,
      taskId,
      gateId: `g${index}`,
      note,
    }));
    harness.replay({ type: 'autopilot.decided', decisions });
    const lines = listAutopilotExampleLines(harness.state, harness.task(taskId), gate, 'plan', harness.now);
    expect(lines.length).toBeLessThan(AUTOPILOT_RETRIEVAL_LIMITS.examples);
    expect(lines.join('\n').length).toBeLessThanOrEqual(AUTOPILOT_RETRIEVAL_LIMITS.budget);
  });

  test('the probe is the gate as you would decide it, and the estimate is the model’s guess for it', () => {
    const { harness, taskId, gate } = planHarness();
    const task = harness.task(taskId);
    expect(createAutopilotProbe(harness.state, task, gate, 'plan', harness.now)).toMatchObject({
      kind: 'plan',
      gateId: gate.id,
      taskId,
      note: null,
    });
    expect(
      Option.getOrNull(selectAutopilotEstimate(harness.state, task, gate, 'plan', harness.now))
    ).toMatchObject({
      head: 'gate',
      p: 0.5,
      confidence: 0,
    });
    expect(Option.isNone(selectAutopilotEstimate(harness.state, task, gate, 'question', harness.now))).toBe(
      true
    );
  });
});
