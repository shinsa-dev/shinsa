import {
  type Initiative,
  type InitiativeSheet,
  listInitiativeMembers,
  listInitiatives,
  resolveInitiativeSheet,
  STAGE_WORDS,
  type ShinsaState,
  selectInitiativeByReference,
  type Task,
} from '@shinsa/core';
import {
  type InitiativeSheetView,
  type InitiativeTaskRef,
  type InitiativeView,
  RequestFailed,
} from '@shinsa/core/engine-api/schema';
import { Effect } from 'effect';
import { resolveTaskView } from './task-views.ts';

function resolveTaskRef(task: Task): InitiativeTaskRef {
  return { id: task.id, handle: task.handle ?? null, title: task.title, status: STAGE_WORDS[task.stage] };
}

function resolveProgress(state: ShinsaState, initiative: Initiative, now: number) {
  return resolveInitiativeSheet(state, initiative.id, now)?.progress ?? [];
}

export function resolveInitiativeView(
  state: ShinsaState,
  initiative: Initiative,
  base: string,
  now: number
): InitiativeView {
  const lead = initiative.leadTaskId ? state.tasks[initiative.leadTaskId] : undefined;
  return {
    id: initiative.id,
    name: initiative.name,
    description: initiative.description,
    phases: initiative.phases,
    lead: lead ? resolveTaskRef(lead) : null,
    members: listInitiativeMembers(state, initiative.id).length,
    progress: resolveProgress(state, initiative, now),
    createdAt: initiative.createdAt,
    updatedAt: initiative.updatedAt,
    url: `${base}/initiatives/${initiative.id}`,
  };
}

export function listInitiativeViews(state: ShinsaState, base: string, now: number) {
  return listInitiatives(state).map((initiative) => resolveInitiativeView(state, initiative, base, now));
}

function resolveSheetView(
  state: ShinsaState,
  sheet: InitiativeSheet,
  base: string,
  now: number
): InitiativeSheetView {
  const view = (task: Task) => resolveTaskView(state, task, base);
  return {
    initiative: resolveInitiativeView(state, sheet.initiative, base, now),
    needsYou: sheet.needsYou.map((entry) => ({ task: view(entry.task), reason: entry.reason })),
    now: sheet.now.map(view),
    next: sheet.next.map((group) => ({
      phase: group.phase,
      tasks: group.tasks.map((entry) => ({
        task: view(entry.task),
        waitsOn: entry.waitsOn.map(resolveTaskRef),
      })),
    })),
    shipped: sheet.shipped.map(view),
    dropped: sheet.dropped.map((entry) => ({ task: view(entry.task), reason: entry.reason })),
    decisions: sheet.decisions.flatMap(({ taskId, ...decision }) => {
      const task = state.tasks[taskId];
      return task ? [{ ...decision, task: resolveTaskRef(task) }] : [];
    }),
  };
}

export const findInitiativeSheet = Effect.fn('findInitiativeSheet')(function* (
  state: ShinsaState,
  ref: string,
  base: string,
  now: number
) {
  const initiative = selectInitiativeByReference(listInitiatives(state), ref);
  const sheet = initiative ? resolveInitiativeSheet(state, initiative.id, now) : null;
  if (!sheet) {
    return yield* new RequestFailed({
      code: 'initiative_not_found',
      message: `No initiative ${ref}. \`shinsa initiatives list\` lists them.`,
    });
  }
  return resolveSheetView(state, sheet, base, now);
});
