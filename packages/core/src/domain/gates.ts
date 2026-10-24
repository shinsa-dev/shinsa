import { resolveGateDefinition } from './steps.ts';
import type { Gate, GateType } from './types.ts';

const DECISION_GATES: ReadonlySet<GateType> = new Set<GateType>(['plan', 'review', 'merge']);

const AGENT_QUESTION_GATES: ReadonlySet<GateType> = new Set<GateType>(['question', 'secret']);

export function isPausingGate(gate: Pick<Gate, 'type'>) {
  return resolveGateDefinition(gate).pauses;
}

export function isDecisionGate(gate: Pick<Gate, 'type'>) {
  return DECISION_GATES.has(gate.type);
}

export function isAgentQuestion(gate: Pick<Gate, 'type'>) {
  return AGENT_QUESTION_GATES.has(gate.type);
}
