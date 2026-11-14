import { Option } from 'effect';
import type { FindingVerdict } from '../domain/schema.ts';
import { resolveAutopilotPolicy } from '../domain/settings.ts';
import type { FindingVerdictKind, Gate, Task } from '../domain/types.ts';
import type { ReviewFinding } from '../report/types.ts';
import type { ShinsaState } from '../state/project.ts';
import { resolveAutopilotFindingLimit } from './limits.ts';
import { selectAutopilotModelGuess } from './model/learn.ts';
import type { AutopilotModelGuess } from './model/schema.ts';
import { createAutopilotDecision } from './profile.ts';
import { AUTOPILOT_COMBINE_LIMITS, AUTOPILOT_FINDING_LIMITS } from './schema.ts';

export interface AutopilotFindingCall {
  verdict: FindingVerdictKind;
  verdicts: FindingVerdict[];
  guesses: AutopilotModelGuess[];
}

interface FindingGuess {
  index: number;
  guess: AutopilotModelGuess;
}

function listOpenFindings(task: Task) {
  return task.findings.flatMap((finding, index) => (finding.verdict ? [] : [{ index, finding }]));
}

function selectFindingGuess(
  state: ShinsaState,
  task: Task,
  gate: Gate,
  open: { index: number; finding: ReviewFinding },
  now: number
): Option.Option<FindingGuess> {
  const probe = createAutopilotDecision(
    state,
    { task, gate, kind: 'finding', answer: 'fixed', note: null, finding: open.finding },
    now
  );
  return selectAutopilotModelGuess(state.autopilotModel, probe).pipe(
    Option.filter((guess) => guess.confidence >= AUTOPILOT_COMBINE_LIMITS.confidence),
    Option.map((guess) => ({ index: open.index, guess }))
  );
}

function resolveFindingVerdict(guess: AutopilotModelGuess): FindingVerdictKind {
  return guess.p >= AUTOPILOT_FINDING_LIMITS.fix ? 'fix' : 'dismiss';
}

export function selectAutopilotFindingCall(
  state: ShinsaState,
  task: Task,
  gate: Gate,
  now: number
): Option.Option<AutopilotFindingCall> {
  if (!resolveAutopilotFindingLimit(state, resolveAutopilotPolicy(state.settings), task).allowed)
    return Option.none();
  const open = listOpenFindings(task);
  if (open.length === 0) return Option.none();
  const found = open.map((each) => selectFindingGuess(state, task, gate, each, now));
  if (!found.every(Option.isSome)) return Option.none();
  const guesses = found.map((each) => each.value);
  const verdicts = guesses.map(({ index, guess }): FindingVerdict => ({
    index,
    verdict: resolveFindingVerdict(guess),
    note: null,
  }));
  return Option.some({
    verdict: verdicts.some((each) => each.verdict === 'fix') ? 'fix' : 'dismiss',
    verdicts,
    guesses: guesses.map(({ guess }) => guess),
  });
}

function describeCount(count: number) {
  return count === 1 ? 'the finding' : `the ${count} findings`;
}

function describeDid(fixes: number, dismissals: number) {
  if (dismissals === 0) return `Autopilot sent ${describeCount(fixes)} back to fix`;
  if (fixes === 0) return `Autopilot dismissed ${describeCount(dismissals)}`;
  return `Autopilot sent ${fixes} of the findings back to fix and dismissed ${dismissals}`;
}

function describeChances(guesses: readonly AutopilotModelGuess[]) {
  const chances = guesses.map((guess) => `${Math.round(guess.p * 100)}%`);
  if (chances.length === 1) return chances[0] ?? '';
  return `${chances.slice(0, -1).join(', ')} and ${chances.at(-1) ?? ''}`;
}

export function describeAutopilotFindingCall(call: AutopilotFindingCall) {
  const fixes = call.verdicts.filter((each) => each.verdict === 'fix').length;
  const did = describeDid(fixes, call.verdicts.length - fixes);
  const chances = describeChances(call.guesses);
  if (call.guesses.length === 1) {
    const similar = Math.round(call.guesses[0]?.similar ?? 0);
    return `${did}: from ${similar} findings like it, it puts the chance you fix it at ${chances}.`;
  }
  return `${did}: from your verdicts on findings like each, it puts the chance you fix them at ${chances}.`;
}
