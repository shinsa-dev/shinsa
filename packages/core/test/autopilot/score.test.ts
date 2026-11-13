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
      progress: 0,
      ready: false,
      suggested: 'balanced',
    });
    expect(scoreOf([decision(null), decision(null)])).toMatchObject({
      learned: 2,
      scored: 0,
      agreement: null,
      progress: 0,
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
    expect(scoreOf(agreeing)).toMatchObject({
      scored: 50,
      agreement: 1,
      progress: 1,
      ready: true,
      suggested: 'most',
    });
    expect(scoreOf(agreeing.slice(1))).toMatchObject({ progress: 0.98, ready: false, suggested: 'balanced' });
    const early = [...Array.from({ length: 5 }, () => decision('act', 'revised')), ...agreeing.slice(5)];
    const late = [...agreeing.slice(5), ...Array.from({ length: 5 }, () => decision('act', 'revised'))];
    expect(scoreOf(early)).toMatchObject({ scored: 50, agreed: 45, ready: true });
    expect(scoreOf(late)).toMatchObject({ scored: 50, agreed: 45, ready: false });
    expect(scoreOf(late).progress).toBeLessThan(1);
  });

  test('counts every guess it ever made, the recent ones the most', () => {
    const old = Array.from({ length: 200 }, () => decision('act', 'revised'));
    const recent = Array.from({ length: 300 }, () => decision('act'));
    const score = scoreOf([...old, ...recent]);
    expect(score).toMatchObject({ learned: 500, scored: 500, agreed: 300, ready: true });
    expect(score.agreement).toBeGreaterThan(0.9);
    expect(scoreOf([...recent, ...old])).toMatchObject({ scored: 500, ready: false });
  });

  test('keeps scoring apart from the words it keeps, so findings and questions never push guesses out', () => {
    const unscored = (kind: AutopilotDecision['kind']) => ({ ...decision(null), kind });
    let profile = recordAutopilotDecisions(undefined, []);
    for (let review = 0; review < 100; review += 1) {
      profile = recordAutopilotDecisions(profile, [
        { ...decision('act'), kind: 'review' },
        ...Array.from({ length: 4 }, () => unscored('finding')),
        unscored('question'),
      ]);
    }
    expect(resolveAutopilotScore({ autopilotProfile: profile })).toMatchObject({
      learned: 600,
      scored: 100,
      agreed: 100,
      ready: true,
      suggested: 'most',
    });
  });
});
