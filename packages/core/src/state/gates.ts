import { isAgentQuestion, isPausingGate } from '../domain/index.ts';
import type { EventOf, ShinsaEvent } from '../events/index.ts';
import { describeDecision } from './activity.ts';
import { writeEntry } from './draft.ts';
import type { ShinsaState } from './project.ts';
import { applyVerdicts } from './reviews.ts';
import { record, updateGate } from './write.ts';

type GateEvent = Extract<
  ShinsaEvent,
  { type: 'gate.opened' | 'gate.answered' | 'gate.withdrawn' | 'gate.noted' | 'gate.superseded' }
>;

function applyGateOpened(state: ShinsaState, event: EventOf<'gate.opened'>) {
  const gate = { ...event.gate };
  writeEntry(state, 'gates', gate.id, gate);
  if (isAgentQuestion(gate)) {
    record(state, gate.taskId, event.at, {
      actor: 'agent',
      kind: 'question',
      text: gate.title,
      runId: gate.runId,
    });
    return;
  }
  if (!isPausingGate(gate)) return;
  record(state, gate.taskId, event.at, {
    actor: 'shinsa',
    kind: 'failure',
    text: gate.title,
    runId: gate.runId,
    gateType: gate.type,
  });
}

function applyGateAnswered(state: ShinsaState, event: EventOf<'gate.answered'>) {
  updateGate(state, event.gateId, {
    status: 'answered',
    decision: event.decision,
    response: event.response,
    answeredAt: event.at,
    ...(event.verdicts ? { verdicts: event.verdicts } : {}),
  });
  const gate = state.gates[event.gateId];
  if (!gate) return;
  if (event.verdicts) applyVerdicts(state, gate.taskId, event.at, event.verdicts);
  record(state, gate.taskId, event.at, {
    actor: 'you',
    kind: 'decision',
    text: describeDecision(event.decision, gate.title),
    detail: event.response,
    ...(event.comments ? { comments: event.comments } : {}),
  });
}

function applyGateSuperseded(state: ShinsaState, event: EventOf<'gate.superseded'>) {
  updateGate(state, event.gateId, { status: 'withdrawn', answeredAt: event.at, supersededBy: event.text });
  const gate = state.gates[event.gateId];
  if (!gate) return;
  record(state, gate.taskId, event.at, {
    actor: 'you',
    kind: 'question',
    text: `Replied in the chat instead of answering: ${gate.title}`,
  });
}

export function applyGateEvent(state: ShinsaState, event: GateEvent) {
  switch (event.type) {
    case 'gate.opened':
      applyGateOpened(state, event);
      return;
    case 'gate.answered':
      applyGateAnswered(state, event);
      return;
    case 'gate.withdrawn':
      updateGate(state, event.gateId, { status: 'withdrawn', answeredAt: event.at });
      return;
    case 'gate.noted':
      updateGate(state, event.gateId, { notes: event.notes });
      return;
    case 'gate.superseded':
      applyGateSuperseded(state, event);
      return;
  }
}
