import type { Gate } from '../domain/types.ts';
import type { ShinsaState } from '../state/project.ts';
import { AUTOPILOT_FOLLOW_UP_LIMITS, type AutopilotLimit } from './schema.ts';

export function isAutopilotFollowUp(gate: Gate) {
  return gate.status === 'answered' && gate.decision === 'revise' && gate.autopilotAnswer !== undefined;
}

function isSamePoint(gate: Gate, other: Gate) {
  return (
    other.taskId === gate.taskId &&
    other.type === gate.type &&
    other.id !== gate.id &&
    (other.round ?? 1) === (gate.round ?? 1) &&
    other.status === 'answered'
  );
}

function listAutopilotFollowUps(state: Pick<ShinsaState, 'gates'>, gate: Gate) {
  const earlier = Object.values(state.gates).filter((other) => isSamePoint(gate, other));
  const yours = earlier
    .filter((other) => other.autopilotAnswer === undefined)
    .map((other) => other.answeredAt ?? other.openedAt);
  const since = yours.length === 0 ? -Infinity : Math.max(...yours);
  return earlier
    .filter((other) => isAutopilotFollowUp(other) && (other.answeredAt ?? other.openedAt) > since)
    .sort((a, b) => (a.answeredAt ?? a.openedAt) - (b.answeredAt ?? b.openedAt));
}

export function resolveFollowUpLimit(state: Pick<ShinsaState, 'gates'>, gate: Gate): AutopilotLimit {
  const sent = listAutopilotFollowUps(state, gate).length;
  if (sent < AUTOPILOT_FOLLOW_UP_LIMITS.perGate) return { allowed: true };
  return {
    allowed: false,
    setting: false,
    reason: `Autopilot already followed up ${sent} times here, so this waits for you.`,
  };
}

export function listAutopilotFollowUpLines(state: Pick<ShinsaState, 'gates'>, gate: Gate) {
  const sent = listAutopilotFollowUps(state, gate);
  if (sent.length === 0) return [];
  return [
    `Follow-ups you already sent here (${sent.length} of ${AUTOPILOT_FOLLOW_UP_LIMITS.perGate}), oldest first:`,
    ...sent.map((other) => `- “${(other.response ?? '').trim()}”`),
  ];
}
