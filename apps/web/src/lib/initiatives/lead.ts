import {
  compareTasks,
  type Initiative,
  isLeadTask,
  listInitiativeWork,
  selectInitiativeLead,
  type ShinsaState,
  type Task,
} from '@shinsa/core';
import { sendCommandWithToast } from '@/lib/connection/commands.ts';

export const START_LEAD = {
  title: 'Start a lead',
  description: 'An agent that files and orders this initiative’s tasks and reports here.',
  submit: 'Start lead',
  sourceLabel: 'Start from',
  sourceHint: 'Starting from a task’s chat gives the lead everything that task already knows.',
} as const;

export const NO_LEAD = {
  title: 'No lead yet',
  body: 'A lead wakes when its tasks move, files and orders the next pieces and writes where the work stands here. Plans, reviews and merges stay yours.',
} as const;

export const LEAD_FROM_TASK = 'Start a lead from this chat';

export const FRESH_LEAD = 'fresh';

export const NO_REPORT = 'The lead hasn’t reported yet. Its first turn reads the initiative and writes here.';

export interface LeadSourceItem {
  value: string;
  label: string;
  hint?: string;
}

export interface LeadView {
  lead: Task;
  narrative: string | null;
  questions: readonly string[];
  at: number | null;
}

export function selectLeadView(state: ShinsaState, initiative: Initiative): LeadView | null {
  const lead = selectInitiativeLead(state, initiative);
  if (!lead) return null;
  const report = initiative.report ?? null;
  return {
    lead,
    narrative: report?.narrative ?? null,
    questions: report?.questions ?? [],
    at: report?.at ?? null,
  };
}

export function listLeadSources(state: ShinsaState, initiative: Initiative): LeadSourceItem[] {
  const tasks = listInitiativeWork(state, initiative.id).sort(compareTasks);
  return [
    { value: FRESH_LEAD, label: 'A new conversation' },
    ...tasks.map((task) => ({
      value: task.id,
      label: task.title,
      ...(task.handle ? { hint: task.handle } : {}),
    })),
  ];
}

export function canLeadFromTask(state: ShinsaState, task: Task) {
  if (isLeadTask(task) || !task.initiativeId) return null;
  const initiative = state.initiatives[task.initiativeId];
  if (!initiative || selectInitiativeLead(state, initiative)) return null;
  return initiative;
}

export function startLead(initiative: Initiative, source: string) {
  const forkOf = source === FRESH_LEAD ? null : source;
  return sendCommandWithToast(
    { type: 'initiative.start_lead', initiativeId: initiative.id, forkOf },
    `Started a lead for “${initiative.name}”.`
  );
}
