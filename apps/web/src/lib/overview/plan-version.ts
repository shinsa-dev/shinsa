import type { PlanChange, Task } from '@shinsa/core';
import { formatCount } from '@/lib/format/count.ts';

export interface PlanVersion {
  summary: string | null;
  changes: PlanChange[];
  feedback: string | null;
}

export function resolvePlanVersion(task: Task): PlanVersion | null {
  const plan = task.plan;
  if (!plan || plan.version < 2) return null;
  return {
    summary: plan.changeSummary ?? null,
    changes: plan.changes ?? [],
    feedback: plan.feedback ?? null,
  };
}

export function listRevisionChanges(task: Task | null, summary: string | null): PlanChange[] {
  if (!task || !summary) return [];
  const revisions = [...(task.planHistory ?? []), ...(task.plan ? [task.plan] : [])].reverse();
  return revisions.find((revision) => revision.changeSummary === summary.trim())?.changes ?? [];
}

export function describePlanEyebrow(task: Task) {
  const version = task.plan?.version ?? 1;
  const phases = formatCount(task.plan?.document?.phases.length ?? 0, 'phase', 'phases');
  return version > 1 ? `Version ${version} · ${phases}` : phases;
}
