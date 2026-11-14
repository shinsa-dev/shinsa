import { Option } from 'effect';
import type { FindingVerdict } from '../domain/schema.ts';
import { resolveAutopilotPolicy } from '../domain/settings.ts';
import type { FindingVerdictKind, Gate, Task } from '../domain/types.ts';
import type { ShinsaState } from '../state/project.ts';
import { resolveAutopilotFindingLimit } from './limits.ts';
import { selectAutopilotModelGuess } from './model/learn.ts';
import type { AutopilotModelGuess } from './model/schema.ts';
import { createAutopilotDecision } from './profile.ts';
import { AUTOPILOT_COMBINE_LIMITS, AUTOPILOT_FINDING_LIMITS } from './schema.ts';

export interface AutopilotFindingCall {
  verdict: FindingVerdictKind;
  verdicts: FindingVerdict[];
  guess: AutopilotModelGuess;
}

function listOpenFindings(task: Task) {
  return task.findings.flatMap((finding, index) => (finding.verdict ? [] : [index]));
}

export function selectAutopilotFindingCall(
  state: ShinsaState,
  task: Task,
  gate: Gate,
  now: number
): Option.Option<AutopilotFindingCall> {
  if (!resolveAutopilotFindingLimit(state, resolveAutopilotPolicy(state.settings)).allowed)
    return Option.none();
  const open = listOpenFindings(task);
  if (open.length === 0) return Option.none();
  const probe = createAutopilotDecision(
    state,
    { task, gate, kind: 'finding', answer: 'fixed', note: null },
    now
  );
  return Option.flatMap(selectAutopilotModelGuess(state.autopilotModel, probe), (guess) => {
    if (guess.confidence < AUTOPILOT_COMBINE_LIMITS.confidence) return Option.none();
    const verdict: FindingVerdictKind = guess.p >= AUTOPILOT_FINDING_LIMITS.fix ? 'fix' : 'dismiss';
    return Option.some({ verdict, verdicts: open.map((index) => ({ index, verdict, note: null })), guess });
  });
}

export function describeAutopilotFindingCall(call: AutopilotFindingCall) {
  const count = call.verdicts.length;
  const findings = count === 1 ? 'the finding' : `the ${count} findings`;
  const chance = Math.round(call.guess.p * 100);
  const similar = Math.round(call.guess.similar);
  const did =
    call.verdict === 'fix' ? `Autopilot sent ${findings} back to fix` : `Autopilot dismissed ${findings}`;
  return `${did}: from ${similar} findings like these, it puts the chance you fix them at ${chance}%.`;
}
