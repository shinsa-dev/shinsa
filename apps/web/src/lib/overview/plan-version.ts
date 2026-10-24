import { describePlanChange, type Task } from '@shinsa/core';
import { formatCount } from '@/lib/format/count.ts';

export interface PlanVersion {
  summary: string | null;
  changes: string[];
  feedback: string | null;
}

export function resolvePlanVersion(task: Task): PlanVersion | null {
  const plan = task.plan;
  if (!plan || plan.version < 2) return null;
  const summary = plan.changeSummary ?? null;
  const changes = (plan.changes ?? []).map(describePlanChange);
  if (!summary && changes.length === 0) return null;
  return { summary, changes, feedback: plan.feedback ?? null };
}

export function describePlanEyebrow(task: Task) {
  const version = task.plan?.version ?? 1;
  const phases = formatCount(task.plan?.document?.phases.length ?? 0, 'phase', 'phases');
  return version > 1 ? `Version ${version} · ${phases}` : phases;
}
