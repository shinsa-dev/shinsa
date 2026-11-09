import { type Initiative, selectInitiativeLead, type ShinsaState, type Task } from '@shinsa/core';

export const NO_REPORT = 'The lead hasn’t reported yet. Its first turn reads the initiative and writes here.';

export interface LeadView {
  live: boolean;
  narrative: string | null;
  questions: readonly string[];
  at: number | null;
}

export function selectLedInitiative(state: ShinsaState, task: Task) {
  if (!task.initiativeId) return null;
  const initiative = state.initiatives[task.initiativeId];
  return initiative?.leadTaskId === task.id ? initiative : null;
}

export function resolveLeadView(state: ShinsaState, initiative: Initiative): LeadView {
  const report = initiative.report ?? null;
  return {
    live: selectInitiativeLead(state, initiative) !== null,
    narrative: report?.narrative ?? null,
    questions: report?.questions ?? [],
    at: report?.at ?? null,
  };
}
