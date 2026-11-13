import { describe, expect, test } from 'bun:test';
import {
  AUTOPILOT_PROFILE_LIMITS,
  type AutopilotDecision,
  EMPTY_AUTOPILOT_PROFILE,
  listAutopilotTallies,
  type ReviewFinding,
  type ReviewRatings,
  recordAutopilotDecisions,
} from '../../src/index.ts';
import { buildAll, createHarness, createTask, type Harness, PASSING } from '../harness.ts';

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
