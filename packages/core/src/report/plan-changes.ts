import { Option } from 'effect';
import { resolveComparableText } from '../chat/text.ts';
import type { PlanDocument, PlanPhase } from './types.ts';

export type PlanChange =
  | { kind: 'goal' }
  | { kind: 'approach' }
  | { kind: 'phase_added'; title: string }
  | { kind: 'phase_removed'; title: string }
  | { kind: 'phase_changed'; title: string }
  | { kind: 'phases_reordered' }
  | { kind: 'files'; added: number; removed: number };

function listTitles(steps: PlanPhase[]) {
  return steps.map((step) => resolveComparableText(step.title));
}

function listPhaseChanges(before: PlanPhase[], after: PlanPhase[]): PlanChange[] {
  const previous = new Map(before.map((step) => [resolveComparableText(step.title), step]));
  const next = new Map(after.map((step) => [resolveComparableText(step.title), step]));
  const changes: PlanChange[] = [];
  for (const step of after) {
    const earlier = previous.get(resolveComparableText(step.title));
    if (!earlier) changes.push({ kind: 'phase_added', title: step.title });
    else if (resolveComparableText(earlier.detail) !== resolveComparableText(step.detail)) {
      changes.push({ kind: 'phase_changed', title: step.title });
    }
  }
  for (const step of before) {
    if (!next.has(resolveComparableText(step.title)))
      changes.push({ kind: 'phase_removed', title: step.title });
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
    ...(resolveComparableText(before.goal) === resolveComparableText(after.goal)
      ? []
      : [{ kind: 'goal' } as const]),
    ...listPhaseChanges(before.phases, after.phases),
    ...(resolveComparableText(before.approach) === resolveComparableText(after.approach)
      ? []
      : [{ kind: 'approach' } as const]),
    ...countFileChanges(before, after),
  ];
}

export type PhaseChange = 'added' | 'changed';

export function resolvePhaseChange(
  changes: PlanChange[] | undefined,
  title: string
): Option.Option<PhaseChange> {
  const key = resolveComparableText(title);
  for (const change of changes ?? []) {
    if (change.kind === 'phase_added' && resolveComparableText(change.title) === key)
      return Option.some('added');
    if (change.kind === 'phase_changed' && resolveComparableText(change.title) === key)
      return Option.some('changed');
  }
  return Option.none();
}
