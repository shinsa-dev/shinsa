import { Option } from 'effect';
import type { Gate } from '../domain/types.ts';
import type { ShinsaState } from '../state/project.ts';
import { isAutopilotFollowUp } from './follow-ups.ts';
import { selectJudgedGateKind } from './prompt.ts';
import {
  AUTOPILOT_DONE_LIMIT,
  type AutopilotDone,
  type AutopilotDoneAction,
  type AutopilotGateKind,
} from './schema.ts';

function resolveDoneAction(gate: Gate, kind: AutopilotGateKind): AutopilotDoneAction {
  if (kind === 'failure') return gate.decision === 'reject' ? 'cancelled' : 'retried';
  if (gate.decision === 'revise') return 'revised';
  if (kind === 'merge') return 'merged';
  return kind === 'question' ? 'replied' : 'approved';
}

export function isAutopilotDoneSeeable(gate: Gate) {
  return gate.status === 'answered' && gate.autopilotAnswer !== undefined && gate.autopilotSeen !== true;
}

export function listAutopilotDone(state: ShinsaState): AutopilotDone[] {
  const done: AutopilotDone[] = [];
  for (const gate of Object.values(state.gates)) {
    const kind = Option.getOrNull(selectJudgedGateKind(gate));
    const task = state.tasks[gate.taskId];
    if (!kind || !task || !isAutopilotDoneSeeable(gate)) continue;
    done.push({
      gateId: gate.id,
      taskId: task.id,
      gate: kind,
      action: resolveDoneAction(gate, kind),
      title: gate.title,
      reason: gate.autopilotAnswer ?? '',
      followUp: isAutopilotFollowUp(gate) ? gate.response : null,
      at: gate.answeredAt ?? gate.openedAt,
    });
  }
  return done.sort((a, b) => b.at - a.at).slice(0, AUTOPILOT_DONE_LIMIT);
}
