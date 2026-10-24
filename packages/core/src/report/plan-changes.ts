import type { PlanPhase, PlanDocument } from './types.ts';

export type PlanChange =
  | { kind: 'goal' }
  | { kind: 'approach' }
  | { kind: 'phase_added'; title: string }
  | { kind: 'phase_removed'; title: string }
  | { kind: 'phase_changed'; title: string }
  | { kind: 'phases_reordered' }
  | { kind: 'files'; added: number; removed: number };

function normalize(text: string) {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

function listTitles(steps: PlanPhase[]) {
  return steps.map((step) => normalize(step.title));
}

function listPhaseChanges(before: PlanPhase[], after: PlanPhase[]): PlanChange[] {
  const previous = new Map(before.map((step) => [normalize(step.title), step]));
  const next = new Map(after.map((step) => [normalize(step.title), step]));
  const changes: PlanChange[] = [];
  for (const step of after) {
    const earlier = previous.get(normalize(step.title));
    if (!earlier) changes.push({ kind: 'phase_added', title: step.title });
    else if (normalize(earlier.detail) !== normalize(step.detail)) {
      changes.push({ kind: 'phase_changed', title: step.title });
    }
  }
  for (const step of before) {
    if (!next.has(normalize(step.title))) changes.push({ kind: 'phase_removed', title: step.title });
  }
  const kept = listTitles(after).filter((title) => previous.has(title));
  const order = listTitles(before).filter((title) => next.has(title));
  if (kept.some((title, index) => title !== order[index])) changes.push({ kind: 'phases_reordered' });
  return changes;
}

function countFileChanges(before: PlanDocument, after: PlanDocument): PlanChange[] {
  const previous = new Set(before.files.map((file) => file.path));
  const next = new Set(after.files.map((file) => file.path));
  const added = [...next].filter((path) => !previous.has(path)).length;
  const removed = [...previous].filter((path) => !next.has(path)).length;
  return added + removed > 0 ? [{ kind: 'files', added, removed }] : [];
}

export function resolvePlanChanges(before: PlanDocument | null, after: PlanDocument | null): PlanChange[] {
  if (!before || !after) return [];
  return [
    ...(normalize(before.goal) === normalize(after.goal) ? [] : [{ kind: 'goal' } as const]),
    ...listPhaseChanges(before.phases, after.phases),
    ...(normalize(before.approach) === normalize(after.approach) ? [] : [{ kind: 'approach' } as const]),
    ...countFileChanges(before, after),
  ];
}

function describeFiles(added: number, removed: number) {
  const parts = [
    added > 0 ? `${added} new ${added === 1 ? 'file' : 'files'}` : null,
    removed > 0 ? `${removed} ${removed === 1 ? 'file' : 'files'} dropped` : null,
  ].filter((part) => part !== null);
  return `Files: ${parts.join(', ')}`;
}

export function describePlanChange(change: PlanChange) {
  switch (change.kind) {
    case 'goal':
      return 'Changed the goal';
    case 'approach':
      return 'Changed the approach';
    case 'phase_added':
      return `Added the phase “${change.title}”`;
    case 'phase_removed':
      return `Dropped the phase “${change.title}”`;
    case 'phase_changed':
      return `Reworked the phase “${change.title}”`;
    case 'phases_reordered':
      return 'Put the phases in a new order';
    case 'files':
      return describeFiles(change.added, change.removed);
  }
}
