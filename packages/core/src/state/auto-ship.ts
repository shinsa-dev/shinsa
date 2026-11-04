import type { EventOf } from '../events/index.ts';
import type { ShinsaState } from './project.ts';
import { record, updateGate, updateTask } from './write.ts';

export function applyAutoShipScheduled(state: ShinsaState, event: EventOf<'auto_ship.scheduled'>) {
  updateGate(state, event.gateId, { autoShipDue: event.due });
}

export function applyTaskEscalated(state: ShinsaState, event: EventOf<'task.escalated'>) {
  updateTask(state, event.taskId, event.at, { escalation: { at: event.at, reason: event.reason } });
  record(state, event.taskId, event.at, {
    actor: 'shinsa',
    kind: 'decision',
    text: 'Escalated by Auto-ship',
    detail: event.reason,
  });
}

export function clearEscalation(state: ShinsaState, taskId: string, at: number) {
  if (!state.tasks[taskId]?.escalation) return;
  updateTask(state, taskId, at, { escalation: null });
}
