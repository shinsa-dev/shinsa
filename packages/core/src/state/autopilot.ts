import type { EventOf } from '../events/index.ts';
import type { ShinsaState } from './project.ts';
import { record, updateGate, updateTask } from './write.ts';

export function applyAutopilotScheduled(state: ShinsaState, event: EventOf<'autopilot.scheduled'>) {
  updateGate(state, event.gateId, { autopilotDue: event.due });
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

export function clearEscalation(state: ShinsaState, taskId: string, at: number) {
  if (!state.tasks[taskId]?.escalation) return;
  updateTask(state, taskId, at, { escalation: null });
}
