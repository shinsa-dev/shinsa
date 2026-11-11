import type { EventOf } from '../events/index.ts';
import type { ShinsaState } from './project.ts';
import { record, updateGate, updateTask } from './write.ts';

export function applyAutopilotScheduled(state: ShinsaState, event: EventOf<'autopilot.scheduled'>) {
  updateGate(state, event.gateId, { autopilotDue: event.due });
}

export function applyAutopilotJudging(state: ShinsaState, event: EventOf<'autopilot.judging'>) {
  updateGate(state, event.gateId, { autopilotJudging: true });
}

export function applyAutopilotForwarded(state: ShinsaState, event: EventOf<'autopilot.forwarded'>) {
  const gate = state.gates[event.gateId];
  if (!gate) return;
  const judged = gate.autopilotJudging === true && gate.autopilotHeld !== event.reason;
  updateGate(state, event.gateId, { autopilotJudging: false, autopilotHeld: event.reason });
  if (!judged) return;
  record(state, gate.taskId, event.at, {
    actor: 'shinsa',
    kind: 'decision',
    text: `Brought to you by Autopilot: ${gate.title}`,
    detail: event.reason,
  });
}

export function applyTaskEscalated(state: ShinsaState, event: EventOf<'task.escalated'>) {
  updateTask(state, event.taskId, event.at, {
    escalation: { at: event.at, reason: event.reason, handoff: event.handoff },
  });
  record(state, event.taskId, event.at, {
    actor: 'shinsa',
    kind: 'decision',
    text: 'Escalated by Autopilot',
    detail: event.reason,
  });
}

export function applyEscalationRevised(state: ShinsaState, event: EventOf<'task.escalation_revised'>) {
  const escalation = state.tasks[event.taskId]?.escalation;
  if (!escalation) return;
  updateTask(state, event.taskId, event.at, {
    escalation: { at: escalation.at, reason: event.reason, handoff: event.handoff },
  });
  record(state, event.taskId, event.at, {
    actor: 'shinsa',
    kind: 'decision',
    text: 'Autopilot could not merge it',
    detail: event.reason,
  });
}

export function clearEscalation(state: ShinsaState, taskId: string, at: number) {
  if (!state.tasks[taskId]?.escalation) return;
  updateTask(state, taskId, at, { escalation: null });
}
