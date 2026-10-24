import type { Gate, Task } from '@shinsa/core';

const SHORT_COMMIT = 7;

export interface MergedCommit {
  full: string;
  short: string;
}

export function resolveMergedCommit(task: Task, gate: Gate): MergedCommit | null {
  const full = gate.commit ?? task.pullRequest?.mergeCommit ?? null;
  if (!full) return null;
  return { full, short: full.slice(0, SHORT_COMMIT) };
}

function splitIntro(body: string) {
  const start = body.search(/^## /m);
  if (start === -1) return { intro: body.trim(), rest: '' };
  return { intro: body.slice(0, start).trim(), rest: body.slice(start).trim() };
}

export function describeOperationIntro(gate: Gate) {
  return splitIntro(gate.body).intro.replaceAll('`', '');
}

export function resolveOperationBody(gate: Gate, merged: boolean) {
  const { intro, rest } = splitIntro(gate.body);
  const caution = merged ? intro.replace(/^[^\n]*?\.\s+/, '') : intro;
  return { caution, rest };
}

export const OPERATION_SKIP = {
  title: 'Finish without running the operation?',
  body: 'The change stays merged and the task is done. The operation does not run.',
  action: 'Finish without it',
};

export type OperationRun = 'runOperation' | 'runOperationWithNotes' | 'runOperationWithoutNotes';

export function resolveOperationRun(
  gate: Pick<Gate, 'notes'>,
  text: string
): { reply: OperationRun; response: string | null } {
  const notes = text.trim();
  if (notes === (gate.notes ?? '').trim()) return { reply: 'runOperation', response: null };
  if (!notes) return { reply: 'runOperationWithoutNotes', response: '' };
  return { reply: 'runOperationWithNotes', response: notes };
}
