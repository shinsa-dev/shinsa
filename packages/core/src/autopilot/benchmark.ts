import { Option } from 'effect';
import type { AutopilotLearnedDecision } from './model/schema.ts';
import { selectAutopilotJudgments } from './profile.ts';
import {
  AUTOPILOT_BENCHMARK_SCOPES,
  AUTOPILOT_DECISION_KINDS,
  AUTOPILOT_TRACKS,
  type AutopilotBenchmark,
  type AutopilotBenchmarkKind,
  type AutopilotBenchmarkRow,
  type AutopilotBenchmarkScope,
  type AutopilotTrack,
  EMPTY_AUTOPILOT_PROFILE,
} from './schema.ts';
import { resolveAutopilotLoss } from './score.ts';

interface Tally {
  scored: number;
  agreed: number;
  loss: number;
}

function resolveTallyKey(
  kind: AutopilotBenchmarkKind,
  scope: AutopilotBenchmarkScope,
  track: AutopilotTrack
) {
  return `${kind}:${scope}:${track}`;
}

function addTally(tallies: Map<string, Tally>, key: string, right: boolean, loss: number) {
  const tally = tallies.get(key) ?? { scored: 0, agreed: 0, loss: 0 };
  tallies.set(key, {
    scored: tally.scored + 1,
    agreed: tally.agreed + (right ? 1 : 0),
    loss: tally.loss + loss,
  });
}

function listRows(tallies: Map<string, Tally>) {
  const kinds: AutopilotBenchmarkKind[] = [...AUTOPILOT_DECISION_KINDS, 'total'];
  return kinds.flatMap((kind) =>
    AUTOPILOT_BENCHMARK_SCOPES.flatMap((scope) =>
      AUTOPILOT_TRACKS.flatMap((track): AutopilotBenchmarkRow[] => {
        const tally = tallies.get(resolveTallyKey(kind, scope, track));
        if (!tally) return [];
        return [
          {
            kind,
            scope,
            track,
            scored: tally.scored,
            agreed: tally.agreed,
            agreement: tally.agreed / tally.scored,
            loss: tally.loss / tally.scored,
          },
        ];
      })
    )
  );
}

export function resolveAutopilotBenchmark(history: readonly AutopilotLearnedDecision[]): AutopilotBenchmark {
  const tallies = new Map<string, Tally>();
  let rates = EMPTY_AUTOPILOT_PROFILE.rates;
  let judged = 0;
  for (const decision of history) {
    const result = selectAutopilotJudgments(rates, decision);
    if (Option.isNone(result)) continue;
    const { positive, judgments } = result.value;
    rates = result.value.rates;
    judged += 1;
    const scopes: AutopilotBenchmarkScope[] = decision.guess === null ? ['all'] : ['all', 'shared'];
    for (const judgment of judgments) {
      const loss = resolveAutopilotLoss(judgment.p, positive);
      for (const scope of scopes)
        for (const kind of [decision.kind, 'total'] as const)
          addTally(tallies, resolveTallyKey(kind, scope, judgment.track), judgment.right, loss);
    }
  }
  return { decisions: history.length, judged, rows: listRows(tallies) };
}
