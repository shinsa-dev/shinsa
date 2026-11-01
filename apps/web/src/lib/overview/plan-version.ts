import type { PlanChange, PlanRevision, Task } from '@shinsa/core';
import { formatCount } from '@/lib/format/count.ts';

export function resolvePlanChanges(task: Task): PlanChange[] {
  const plan = task.plan;
  if (!plan || plan.version < 2) return [];
  return plan.changes ?? [];
}

export function selectPlanRevision(
  task: Task | null,
  goal: string | null,
  at: number | null
): PlanRevision | null {
  if (!task || !goal) return null;
  const revisions = [...(task.planHistory ?? []), ...(task.plan ? [task.plan] : [])]
    .filter((revision) => revision.document?.goal === goal)
    .reverse();
  if (at === null) return revisions[0] ?? null;
  return revisions.reduce<PlanRevision | null>(
    (closest, revision) =>
      !closest || Math.abs(revision.proposedAt - at) < Math.abs(closest.proposedAt - at) ? revision : closest,
    null
  );
}

export function describePlanEyebrow(task: Task) {
  const version = task.plan?.version ?? 1;
  const phases = formatCount(task.plan?.document?.phases.length ?? 0, 'phase', 'phases');
  return version > 1 ? `Version ${version} · ${phases}` : phases;
}
