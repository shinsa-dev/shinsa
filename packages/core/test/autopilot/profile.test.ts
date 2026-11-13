import { describe, expect, test } from 'bun:test';
import {
  AUTOPILOT_PROFILE_LIMITS,
  type AutopilotDecision,
  EMPTY_AUTOPILOT_PROFILE,
  listAutopilotProfileLines,
  listAutopilotTallies,
  type ReviewFinding,
  type ReviewRatings,
  recordAutopilotDecisions,
} from '../../src/index.ts';
import { buildAll, createHarness, createTask, type Harness, PASSING } from '../harness.ts';

const NO_CONTEXT = { projectId: null, risk: null };

const HIGH_LOW: ReviewRatings = { confidence: 'high', risk: 'low' };

const OPTIONAL: ReviewFinding = { severity: 'optional', file: 'a.ts', line: 3, message: 'Rename it.' };

function reachReview(harness: Harness, findings: ReviewFinding[] = []) {
  const taskId = createTask(harness);
  buildAll(harness, taskId);
  harness.send({ type: 'checks.record', taskId, results: PASSING });
  harness.send({
    type: 'agent.report_review',
    ratings: HIGH_LOW,
    runId: harness.activeRun(taskId).id,
    summary: null,
    findings,
  });
  return taskId;
}

function decisions(harness: Harness) {
  return harness.state.autopilotProfile.decisions;
}

function decision(overrides: Partial<AutopilotDecision>): AutopilotDecision {
  return {
    at: 1,
    taskId: 't',
    gateId: null,
    kind: 'review',
    answer: 'approved',
    projectId: null,
    risk: null,
    scope: null,
    urgent: false,
    watchdog: false,
    touched: false,
    guess: null,
    note: null,
    ...overrides,
  };
}

describe('the decisions Autopilot learns from', () => {
  test('a review you approve is learned with Autopilot off, with its risk and scope', () => {
    const harness = createHarness();
    const taskId = reachReview(harness);
    harness.send({
      type: 'gate.answer',
      gateId: harness.openGate(taskId).id,
      decision: 'approve',
      response: null,
    });
    expect(decisions(harness)).toEqual([
      expect.objectContaining({
        taskId,
        kind: 'review',
        answer: 'approved',
        risk: 'low',
        urgent: false,
        watchdog: false,
        touched: false,
        note: null,
      }),
    ]);
    expect(decisions(harness)[0]?.scope).toEqual({ phases: expect.any(Number), files: expect.any(Number) });
    expect(harness.state.autopilotProfile.total).toBe(1);
  });

  test('each finding you decide is learned beside the review answer', () => {
    const harness = createHarness();
    const taskId = reachReview(harness, [OPTIONAL, OPTIONAL]);
    harness.send({
      type: 'gate.answer',
      gateId: harness.openGate(taskId).id,
      decision: 'revise',
      response: 'Fix the first.',
      verdicts: [
        { index: 0, verdict: 'fix', note: null },
        { index: 1, verdict: 'dismiss', note: '  Intended.  ' },
      ],
    });
    expect(decisions(harness).map(({ kind, answer, note }) => [kind, answer, note])).toEqual([
      ['review', 'revised', 'Fix the first.'],
      ['finding', 'fixed', null],
      ['finding', 'dismissed', 'Intended.'],
    ]);
  });

  test('a suggested task you accept or dismiss is learned, but not one an agent settles for you', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({
      type: 'agent.suggest_tasks',
      runId: harness.activeRun(taskId).id,
      suggestions: ['Cache it', 'Retry it', 'Log it'].map((title) => ({
        title,
        request: `${title}, please.`,
        why: 'It came up.',
        waitsOnThis: false,
      })),
    });
    const [first, second, third] = harness.task(taskId).suggestions ?? [];
    harness.send({ type: 'suggestion.accept', taskId, suggestionId: first?.id ?? '', waitsOnThis: false });
    harness.send({ type: 'suggestion.dismiss', taskId, suggestionId: second?.id ?? '' });
    harness.send({ type: 'suggestion.dismiss', taskId, suggestionId: third?.id ?? '' }, { onBehalf: true });
    expect(decisions(harness).map(({ kind, answer, note, gateId }) => [kind, answer, note, gateId])).toEqual([
      ['suggestion', 'accepted', 'Cache it', null],
      ['suggestion', 'dismissed', 'Retry it', null],
    ]);
  });
});

describe('the profile', () => {
  test('counts each kind overall, per project and per risk, and keeps counting past the kept decisions', () => {
    const many = Array.from({ length: AUTOPILOT_PROFILE_LIMITS.kept + 5 }, (_, index) =>
      decision({ at: index, projectId: 'p1', risk: 'low', answer: index % 2 ? 'revised' : 'approved' })
    );
    const profile = recordAutopilotDecisions(undefined, many);
    expect(profile.total).toBe(AUTOPILOT_PROFILE_LIMITS.kept + 5);
    expect(profile.decisions).toHaveLength(AUTOPILOT_PROFILE_LIMITS.kept);
    expect(profile.decisions[0]?.at).toBe(5);
    expect(listAutopilotTallies({ autopilotProfile: profile }, 'review')).toEqual([
      {
        key: 'review||',
        kind: 'review',
        projectId: null,
        risk: null,
        total: 205,
        answers: { approved: 103, revised: 102 },
      },
      {
        key: 'review|p1|',
        kind: 'review',
        projectId: 'p1',
        risk: null,
        total: 205,
        answers: { approved: 103, revised: 102 },
      },
      {
        key: 'review||low',
        kind: 'review',
        projectId: null,
        risk: 'low',
        total: 205,
        answers: { approved: 103, revised: 102 },
      },
    ]);
    expect(listAutopilotTallies({ autopilotProfile: profile }, 'plan')).toEqual([]);
  });

  test('a decision with no project or risk only counts toward its kind', () => {
    const profile = recordAutopilotDecisions(EMPTY_AUTOPILOT_PROFILE, [decision({ kind: 'proposal' })]);
    expect(profile.tallies.map((tally) => tally.key)).toEqual(['proposal||']);
  });

  test('keeps the most recently used tallies when there are too many', () => {
    const spread = Array.from({ length: AUTOPILOT_PROFILE_LIMITS.tallies + 1 }, (_, index) =>
      decision({ kind: 'plan', projectId: `p${index}` })
    );
    const profile = recordAutopilotDecisions(undefined, [
      ...spread,
      decision({ kind: 'plan', projectId: 'p0' }),
    ]);
    expect(profile.tallies).toHaveLength(AUTOPILOT_PROFILE_LIMITS.tallies);
    expect(profile.tallies.slice(-2).map((tally) => tally.key)).toEqual(['plan||', 'plan|p0|']);
    expect(profile.tallies.some((tally) => tally.key === 'plan|p1|')).toBe(false);
  });
});

describe('the profile summary for a judgment', () => {
  const profile = (learned: AutopilotDecision[]) => ({
    autopilotProfile: recordAutopilotDecisions(undefined, learned),
  });

  test('is empty until you decided that kind of point', () => {
    expect(
      listAutopilotProfileLines({ autopilotProfile: EMPTY_AUTOPILOT_PROFILE }, 'plan', NO_CONTEXT)
    ).toEqual([]);
    const state = profile([decision({ kind: 'merge' })]);
    expect(listAutopilotProfileLines(state, 'plan', NO_CONTEXT)).toEqual([]);
  });

  test('counts the review and its findings overall, in this project and at this risk, then your recent words', () => {
    const state = profile([
      decision({ kind: 'review', answer: 'approved', projectId: 'p1', risk: 'low', note: 'first' }),
      decision({ kind: 'review', answer: 'revised', projectId: 'p2', risk: 'high', note: 'second' }),
      decision({ kind: 'finding', answer: 'dismissed', projectId: 'p1', risk: 'low', note: 'third' }),
      decision({ kind: 'finding', answer: 'fixed', projectId: 'p1', risk: 'low', note: 'fourth' }),
      decision({ kind: 'merge', answer: 'approved', note: 'not a review' }),
    ]);
    expect(listAutopilotProfileLines(state, 'review', { projectId: 'p1', risk: 'low' })).toEqual([
      '- All reviews: 2 decided: approved 1, revised 1',
      '- In this project: 1 decided: approved 1',
      '- At low risk: 1 decided: approved 1',
      '- All review findings: 2 decided: fixed 1, dismissed 1',
      '- In this project: 2 decided: fixed 1, dismissed 1',
      '- At low risk: 2 decided: fixed 1, dismissed 1',
      'Their recent words:',
      '- review findings, fixed: “fourth”',
      '- review findings, dismissed: “third”',
      '- reviews, revised: “second”',
    ]);
  });

  test('leaves out a project or risk you never decided at, and words when there are none', () => {
    const state = profile([decision({ kind: 'plan', answer: 'approved', projectId: 'p1', risk: 'low' })]);
    expect(listAutopilotProfileLines(state, 'plan', { projectId: 'p9', risk: 'high' })).toEqual([
      '- All plans: 1 decided: approved 1',
    ]);
  });

  test('stays inside its budget', () => {
    const long = 'x'.repeat(AUTOPILOT_PROFILE_LIMITS.summary / 2);
    const state = profile(
      Array.from({ length: 6 }, () => decision({ kind: 'question', answer: 'replied', note: long }))
    );
    const lines = listAutopilotProfileLines(state, 'question', NO_CONTEXT);
    expect(lines.join('\n').length).toBeLessThanOrEqual(AUTOPILOT_PROFILE_LIMITS.summary);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('- All agent questions: 6 decided: replied 6');
  });
});
