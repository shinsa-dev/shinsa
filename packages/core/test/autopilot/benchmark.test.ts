import { describe, expect, test } from 'bun:test';
import {
  type AutopilotDecisionAnswer,
  type AutopilotDecisionKind,
  type AutopilotLearnedDecision,
  type AutopilotModelGuess,
  type AutopilotVerdict,
  recordAutopilotDecisions,
  resolveAutopilotBenchmark,
  resolveAutopilotScore,
} from '../../src/index.ts';

const SURE: AutopilotModelGuess = { head: 'gate', p: 0.95, confidence: 0.8, similar: 40 };
const DOUBTFUL: AutopilotModelGuess = { head: 'gate', p: 0.2, confidence: 0.8, similar: 40 };

function learned(
  kind: AutopilotDecisionKind,
  answer: AutopilotDecisionAnswer,
  guess: AutopilotVerdict | null,
  modelGuess: AutopilotModelGuess | null
): AutopilotLearnedDecision {
  return {
    at: 1,
    taskId: 't',
    gateId: 'g',
    kind,
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
    modelGuess,
  };
}

const HISTORY = [
  learned('review', 'approved', 'act', SURE),
  learned('review', 'revised', 'act', DOUBTFUL),
  learned('review', 'approved', null, SURE),
  learned('finding', 'fixed', null, { ...SURE, head: 'finding' }),
  learned('message', 'sent', null, null),
];

function rowOf(
  benchmark: ReturnType<typeof resolveAutopilotBenchmark>,
  kind: string,
  scope: string,
  track: string
) {
  return benchmark.rows.find((row) => row.kind === kind && row.scope === scope && row.track === track);
}

describe('the Autopilot benchmark', () => {
  test('scores each guesser per kind, on every decision it guessed and on the ones the model call guessed too', () => {
    const benchmark = resolveAutopilotBenchmark(HISTORY);
    expect(benchmark.decisions).toBe(5);
    expect(benchmark.judged).toBe(4);
    expect(rowOf(benchmark, 'review', 'all', 'model')).toMatchObject({ scored: 3, agreed: 3, agreement: 1 });
    expect(rowOf(benchmark, 'review', 'all', 'call')).toMatchObject({ scored: 2, agreed: 1, agreement: 0.5 });
    expect(rowOf(benchmark, 'review', 'shared', 'combined')).toMatchObject({ scored: 2, agreed: 2 });
    expect(rowOf(benchmark, 'review', 'shared', 'model')).toMatchObject({ scored: 2, agreed: 2 });
    expect(rowOf(benchmark, 'finding', 'all', 'model')).toMatchObject({ scored: 1, agreed: 1 });
    expect(rowOf(benchmark, 'finding', 'shared', 'model')).toBeUndefined();
    expect(rowOf(benchmark, 'total', 'all', 'base')?.scored).toBe(4);
    expect(benchmark.rows.some((row) => row.kind === 'message')).toBe(false);
  });

  test('charges a sure wrong guess far more log loss than a hedged one', () => {
    const benchmark = resolveAutopilotBenchmark(HISTORY);
    const call = rowOf(benchmark, 'review', 'shared', 'call');
    const model = rowOf(benchmark, 'review', 'shared', 'model');
    expect(call?.loss).toBeGreaterThan(model?.loss ?? Number.POSITIVE_INFINITY);
  });

  test('scores the same decisions the live score does', () => {
    const benchmark = resolveAutopilotBenchmark(HISTORY);
    const live = resolveAutopilotScore({ autopilotProfile: recordAutopilotDecisions(undefined, HISTORY) });
    expect(rowOf(benchmark, 'total', 'all', 'combined')?.agreed).toBe(live.tracks.combined.agreed);
    expect(rowOf(benchmark, 'total', 'all', 'model')?.scored).toBe(live.tracks.model.scored);
    expect(rowOf(benchmark, 'total', 'all', 'base')?.agreed).toBe(live.tracks.base.agreed);
  });

  test('has no rows for an empty history', () => {
    expect(resolveAutopilotBenchmark([])).toEqual({ decisions: 0, judged: 0, rows: [] });
  });
});
