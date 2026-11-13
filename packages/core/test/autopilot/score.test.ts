import { describe, expect, test } from 'bun:test';
import {
  AUTOPILOT_SCORE_LIMITS,
  type AutopilotDecision,
  type AutopilotDecisionAnswer,
  type AutopilotModelGuess,
  type AutopilotScoredDecision,
  type AutopilotVerdict,
  isAutopilotAgreement,
  recordAutopilotDecisions,
  resolveAutopilotBaseRate,
  resolveAutopilotCombinedVerdict,
  resolveAutopilotLoss,
  resolveAutopilotScore,
} from '../../src/index.ts';

const SURE: AutopilotModelGuess = { head: 'gate', p: 0.95, confidence: 0.8, similar: 40 };
const DOUBTFUL: AutopilotModelGuess = { head: 'gate', p: 0.2, confidence: 0.8, similar: 40 };

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
    facts: null,
  };
}

function guessed(
  guess: AutopilotVerdict | null,
  answer: AutopilotDecisionAnswer,
  modelGuess: AutopilotModelGuess | null
): AutopilotScoredDecision {
  return { ...decision(guess, answer), modelGuess };
}

function scoreOf(decisions: AutopilotScoredDecision[]) {
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

describe('combining the model with the model call', () => {
  test('acts when the call says act, unless a sure model says you would not approve', () => {
    expect(resolveAutopilotCombinedVerdict('act', SURE)).toBe('act');
    expect(resolveAutopilotCombinedVerdict('forward', SURE)).toBe('forward');
    expect(resolveAutopilotCombinedVerdict('act', DOUBTFUL)).toBe('forward');
    expect(resolveAutopilotCombinedVerdict('act', { ...DOUBTFUL, confidence: 0.3 })).toBe('act');
    expect(resolveAutopilotCombinedVerdict('act', null)).toBe('act');
  });
});

describe('the base rate and log loss', () => {
  test('the base rate starts at even and leans to the more common answer', () => {
    expect(resolveAutopilotBaseRate({ positive: 0, negative: 0 })).toBe(0.5);
    expect(resolveAutopilotBaseRate({ positive: 8, negative: 0 })).toBe(0.9);
  });

  test('log loss is small for a sure right guess, large and bounded for a sure wrong one', () => {
    expect(resolveAutopilotLoss(0.5, true)).toBeCloseTo(Math.log(2));
    expect(resolveAutopilotLoss(1, true)).toBeCloseTo(-Math.log(0.99));
    expect(resolveAutopilotLoss(1, false)).toBeCloseTo(-Math.log(0.01));
  });
});

describe('the Autopilot score', () => {
  test('has no agreement and suggests Balanced before any guess is scored', () => {
    const empty = resolveAutopilotScore({ autopilotProfile: undefined as never });
    expect(empty).toMatchObject({
      learned: 0,
      scored: 0,
      agreed: 0,
      agreement: null,
      margin: null,
      value: 0,
      progress: 0,
      ready: false,
      suggested: 'balanced',
    });
    expect(empty.tracks.base).toEqual({
      scored: 0,
      agreed: 0,
      agreement: null,
      base: null,
      margin: null,
      loss: null,
    });
    expect(scoreOf([decision(null), decision(null)])).toMatchObject({
      learned: 2,
      scored: 0,
      agreement: null,
      progress: 0,
    });
  });

  test('scores each track only where it guessed, and the base rate on every decision with a choice', () => {
    const score = scoreOf([
      guessed('act', 'approved', SURE),
      guessed('act', 'revised', SURE),
      guessed(null, 'approved', SURE),
      guessed('forward', 'rejected', DOUBTFUL),
      { ...decision(null, 'sent'), kind: 'message' },
    ]);
    expect(score.learned).toBe(5);
    expect(score.tracks.call).toMatchObject({ scored: 3, agreed: 2 });
    expect(score.tracks.combined).toMatchObject({ scored: 3, agreed: 2 });
    expect(score.tracks.model).toMatchObject({ scored: 4, agreed: 3 });
    expect(score.tracks.base).toMatchObject({ scored: 4 });
    expect(score).toMatchObject({ scored: 3, agreed: 2, ready: false, suggested: 'balanced' });
    expect(score.agreement).toBeCloseTo(2 / 3);
  });

  test('the combined verdict brings a gate to you when the model doubts what the call would do', () => {
    const score = scoreOf([guessed('act', 'revised', DOUBTFUL), guessed('act', 'approved', DOUBTFUL)]);
    expect(score.tracks.call.agreed).toBe(1);
    expect(score.tracks.combined.agreed).toBe(1);
    expect(scoreOf([guessed('act', 'revised', DOUBTFUL)]).tracks).toMatchObject({
      call: { agreed: 0 },
      combined: { agreed: 1 },
    });
  });

  test('compares each track with the base rate on the same decisions', () => {
    const score = scoreOf([
      guessed('act', 'approved', SURE),
      guessed('act', 'approved', SURE),
      guessed('act', 'approved', SURE),
    ]);
    expect(score.tracks.combined.agreement).toBe(1);
    expect(score.tracks.combined.base).toBeCloseTo(1);
    expect(score.margin).toBeCloseTo(0);
    expect(score.tracks.model.loss).toBeLessThan(score.tracks.base.loss ?? 0);
  });

  test('never suggests Most things while always approving would score as well', () => {
    const agreeing = Array.from({ length: AUTOPILOT_SCORE_LIMITS.minScored }, () =>
      guessed('act', 'approved', SURE)
    );
    expect(scoreOf(agreeing)).toMatchObject({
      scored: 50,
      agreement: 1,
      value: 100,
      progress: 1,
      ready: false,
    });
    expect(scoreOf(agreeing).suggested).toBe('balanced');
  });

  test('suggests Most things at 90% agreement and a clear lead over the base rate', () => {
    const mixed = Array.from({ length: 60 }, (_, index) =>
      index % 3 === 0 ? guessed('forward', 'revised', DOUBTFUL) : guessed('act', 'approved', SURE)
    );
    const score = scoreOf(mixed);
    expect(score).toMatchObject({ scored: 60, agreed: 60, agreement: 1, ready: true, suggested: 'most' });
    expect(score.margin).toBeGreaterThanOrEqual(AUTOPILOT_SCORE_LIMITS.margin);
    expect(scoreOf(mixed.slice(11))).toMatchObject({ scored: 49, progress: 0.98, ready: false });
  });

  test('counts every guess it ever made, the recent ones the most', () => {
    const wrong = () => guessed('act', 'revised', SURE);
    const right = (index: number) =>
      index % 3 === 0 ? guessed('forward', 'revised', DOUBTFUL) : guessed('act', 'approved', SURE);
    const old = Array.from({ length: 200 }, wrong);
    const recent = Array.from({ length: 300 }, (_, index) => right(index));
    const score = scoreOf([...old, ...recent]);
    expect(score).toMatchObject({ learned: 500, scored: 500, ready: true });
    expect(score.agreement).toBeGreaterThan(0.9);
    expect(scoreOf([...recent, ...old])).toMatchObject({ scored: 500, ready: false });
  });

  test('keeps scoring apart from the words it keeps, so findings and questions never push guesses out', () => {
    const unscored = (kind: AutopilotDecision['kind']) => ({ ...decision(null, 'fixed'), kind });
    let profile = recordAutopilotDecisions(undefined, []);
    for (let review = 0; review < 100; review += 1) {
      profile = recordAutopilotDecisions(profile, [
        { ...guessed('act', 'approved', SURE), kind: 'review' },
        ...Array.from({ length: 4 }, () => unscored('finding')),
        unscored('question'),
      ]);
    }
    expect(resolveAutopilotScore({ autopilotProfile: profile })).toMatchObject({
      learned: 600,
      scored: 100,
      agreed: 100,
    });
    expect(profile.decisions.every((kept) => !('modelGuess' in kept))).toBe(true);
    expect(profile.rates.finding.positive).toBeGreaterThan(0);
  });
});
