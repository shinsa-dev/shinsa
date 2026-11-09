import {
  type Initiative,
  listInitiatives,
  selectInitiativePhase,
  type ShinsaState,
  type Task,
} from '@shinsa/core';
import { sendCommandWithToast } from '@/lib/connection/commands.ts';

export const ADD_TO_INITIATIVE = 'Add to an initiative';

export const MOVE_TO_INITIATIVE = 'Move to another initiative';

export const PHASE_LABEL = 'Phase';

export const LEAVE_INITIATIVE = 'Take out of the initiative';

export const ADOPT_TASK = 'Make an initiative from this task';

export function selectTaskInitiative(state: ShinsaState, task: Task) {
  return task.initiativeId ? (state.initiatives[task.initiativeId] ?? null) : null;
}

export function describeTaskInitiative(state: ShinsaState, task: Task) {
  const initiative = selectTaskInitiative(state, task);
  if (!initiative) return null;
  const phase = selectInitiativePhase(initiative, task.initiativePhaseId);
  return { initiative, label: phase ? `${initiative.name} · ${phase.name}` : initiative.name };
}

export function listInitiativeChoices(state: ShinsaState, task: Task) {
  return listInitiatives(state).filter((initiative) => initiative.id !== task.initiativeId);
}

export function joinInitiative(task: Task, initiative: Initiative) {
  return sendCommandWithToast(
    { type: 'task.join_initiative', taskId: task.id, initiativeId: initiative.id, phaseId: null },
    `Added to the initiative “${initiative.name}”.`
  );
}

export function changeTaskPhase(task: Task, initiative: Initiative, phaseId: string | null) {
  const phase = selectInitiativePhase(initiative, phaseId);
  return sendCommandWithToast(
    { type: 'task.join_initiative', taskId: task.id, initiativeId: initiative.id, phaseId },
    phase ? `Moved to the phase “${phase.name}”.` : 'Taken out of its phase.'
  );
}

export function leaveInitiative(task: Task, initiative: Initiative) {
  return sendCommandWithToast(
    { type: 'task.join_initiative', taskId: task.id, initiativeId: null, phaseId: null },
    `Taken out of “${initiative.name}”.`
  );
}

export function adoptTask(task: Task) {
  return sendCommandWithToast(
    { type: 'initiative.adopt_task', taskId: task.id },
    'Made an initiative from this task.'
  );
}

export function focusInitiative(initiative: Initiative) {
  return sendCommandWithToast(
    { type: 'focus.change', projectId: null, teamId: null, initiativeId: initiative.id, until: null },
    `Focused on “${initiative.name}”.`
  );
}

export function removeInitiative(initiative: Initiative) {
  return sendCommandWithToast(
    { type: 'initiative.remove', initiativeId: initiative.id },
    `Removed “${initiative.name}”.`
  );
}
