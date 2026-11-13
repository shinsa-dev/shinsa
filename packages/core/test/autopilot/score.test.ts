import { describe, expect, test } from 'bun:test';
import {
  AUTOPILOT_SCORE_LIMITS,
  type AutopilotDecision,
  type AutopilotDecisionAnswer,
  type AutopilotVerdict,
  isAutopilotAgreement,
  recordAutopilotDecisions,
  resolveAutopilotScore,
} from '../../src/index.ts';

function decision(
  guess: AutopilotVerdict | null,
  answer: AutopilotDecisionAnswer = 'approved'
): AutopilotDecision {
  return {
    at: 1,
    taskId: 't',
    gateId: 'g',
    kind: 'plan',
    answer,
    projectId: null,
    risk: null,
    scope: null,
    urgent: false,
    watchdog: false,
    touched: true,
    guess,
    note: null,
  };
}

function scoreOf(decisions: AutopilotDecision[]) {
  return resolveAutopilotScore({ autopilotProfile: recordAutopilotDecisions(undefined, decisions) });
}

describe('agreeing with you', () => {
  test('a guess to act agrees with an approval, a guess to bring it to you with a revision or rejection', () => {
    expect(isAutopilotAgreement('act', 'approved')).toBe(true);
    expect(isAutopilotAgreement('forward', 'approved')).toBe(false);
    expect(isAutopilotAgreement('forward', 'revised')).toBe(true);
    expect(isAutopilotAgreement('forward', 'rejected')).toBe(true);
    expect(isAutopilotAgreement('act', 'revised')).toBe(false);
    expect(isAutopilotAgreement('act', 'replied')).toBe(false);
  });
});

describe('the Autopilot score', () => {
  test('has no agreement and suggests Balanced before any guess is scored', () => {
    expect(resolveAutopilotScore({ autopilotProfile: undefined as never })).toEqual({
      learned: 0,
      scored: 0,
      agreed: 0,
      agreement: null,
      ready: false,
      suggested: 'balanced',
    });
    expect(scoreOf([decision(null), decision(null)])).toMatchObject({
      learned: 2,
      scored: 0,
      agreement: null,
    });
  });

  test('counts every decision as learned and only guessed ones as scored', () => {
    const score = scoreOf([
      decision('act'),
      decision('act', 'revised'),
      decision(null),
      decision('forward', 'rejected'),
    ]);
    expect(score).toMatchObject({ learned: 4, scored: 3, agreed: 2, ready: false, suggested: 'balanced' });
    expect(score.agreement).toBeCloseTo(2 / 3);
  });

  test('suggests Most things once it agrees often enough over enough decisions', () => {
    const agreeing = Array.from({ length: AUTOPILOT_SCORE_LIMITS.minScored }, () => decision('act'));
    expect(scoreOf(agreeing)).toMatchObject({ scored: 50, agreement: 1, ready: true, suggested: 'most' });
    expect(scoreOf(agreeing.slice(1))).toMatchObject({ ready: false, suggested: 'balanced' });
    const missing = [...agreeing.slice(6), ...Array.from({ length: 6 }, () => decision('act', 'revised'))];
    expect(scoreOf(missing)).toMatchObject({ scored: 50, agreed: 44, ready: false });
    const enough = [...agreeing.slice(5), ...Array.from({ length: 5 }, () => decision('act', 'revised'))];
    expect(scoreOf(enough)).toMatchObject({ agreed: 45, agreement: 0.9, ready: true });
  });

  test('scores only the most recent guesses', () => {
    const old = Array.from({ length: 50 }, () => decision('act', 'revised'));
    const recent = Array.from({ length: AUTOPILOT_SCORE_LIMITS.window }, () => decision('act'));
    expect(scoreOf([...old, ...recent])).toMatchObject({
      learned: 150,
      scored: 100,
      agreed: 100,
      ready: true,
    });
  });
});
