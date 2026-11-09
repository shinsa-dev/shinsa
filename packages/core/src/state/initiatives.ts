import { INITIATIVE_LIMITS, type Initiative, selectInitiativePhase, type Task } from '../domain/index.ts';
import type { EventOf, ShinsaEvent } from '../events/index.ts';
import { removeEntry, writeEntry } from './draft.ts';
import type { ShinsaState } from './project.ts';
import { record, updateTask } from './write.ts';

type InitiativeEvent = Extract<
  ShinsaEvent,
  {
    type:
      | 'initiative.written'
      | 'initiative.removed'
      | 'task.initiative_changed'
      | 'initiative.milestones_queued'
      | 'initiative.lead_woken'
      | 'initiative.reported';
  }
>;

function describeMembership(state: ShinsaState, task: Task, event: EventOf<'task.initiative_changed'>) {
  const before = task.initiativeId ? state.initiatives[task.initiativeId] : undefined;
  const after = event.initiativeId ? state.initiatives[event.initiativeId] : undefined;
  if (!after) return before ? `Removed from the initiative ${before.name}` : null;
  const phase = selectInitiativePhase(after, event.phaseId);
  if (task.initiativeId === after.id) {
    return phase ? `Moved to the phase ${phase.name}` : 'Taken out of its phase';
  }
  return phase
    ? `Added to the initiative ${after.name}, phase ${phase.name}`
    : `Added to the initiative ${after.name}`;
}

function applyMembership(state: ShinsaState, event: EventOf<'task.initiative_changed'>) {
  const task = state.tasks[event.taskId];
  if (!task) return;
  const text = describeMembership(state, task, event);
  updateTask(state, event.taskId, event.at, {
    initiativeId: event.initiativeId,
    initiativePhaseId: event.initiativeId ? event.phaseId : null,
  });
  if (text) record(state, event.taskId, event.at, { actor: 'you', kind: 'note', text });
}

function updateInitiative(state: ShinsaState, initiativeId: string, patch: Partial<Initiative>) {
  const initiative = state.initiatives[initiativeId];
  if (!initiative) return;
  writeEntry(state, 'initiatives', initiativeId, { ...initiative, ...patch });
}

function queueMilestones(state: ShinsaState, event: EventOf<'initiative.milestones_queued'>) {
  const queued = [...(state.initiatives[event.initiativeId]?.milestones ?? []), ...event.milestones];
  updateInitiative(state, event.initiativeId, {
    milestones: queued.slice(-INITIATIVE_LIMITS.milestones),
  });
}

export function applyInitiativeEvent(state: ShinsaState, event: InitiativeEvent) {
  switch (event.type) {
    case 'initiative.written':
      writeEntry(state, 'initiatives', event.initiative.id, event.initiative);
      return;
    case 'initiative.removed':
      removeEntry(state, 'initiatives', event.initiativeId);
      return;
    case 'task.initiative_changed':
      applyMembership(state, event);
      return;
    case 'initiative.milestones_queued':
      queueMilestones(state, event);
      return;
    case 'initiative.lead_woken':
      updateInitiative(state, event.initiativeId, { milestones: [] });
      return;
    case 'initiative.reported':
      updateInitiative(state, event.initiativeId, { report: event.report });
      return;
  }
}

function compareInitiatives(left: Initiative, right: Initiative) {
  return left.createdAt - right.createdAt || left.id.localeCompare(right.id);
}

export function listInitiatives(state: ShinsaState): Initiative[] {
  return Object.values(state.initiatives).sort(compareInitiatives);
}

export function listInitiativeMembers(state: ShinsaState, initiativeId: string): Task[] {
  return Object.values(state.tasks).filter((task) => task.initiativeId === initiativeId);
}
