import { describePlanChange, type Task } from '@shinsa/core';
import { formatCount } from '@/lib/format/count.ts';

export interface PlanVersion {
  summary: string | null;
  changes: string[];
  feedback: string | null;
}

export function resolvePlanVersion(task: Task): PlanVersion | null {
  const spec = task.spec;
  if (!spec || spec.version < 2) return null;
  const summary = spec.changeSummary ?? null;
  const changes = (spec.changes ?? []).map(describePlanChange);
  if (!summary && changes.length === 0) return null;
  return { summary, changes, feedback: spec.feedback ?? null };
}

export function describePlanEyebrow(task: Task) {
  const version = task.spec?.version ?? 1;
  const phases = formatCount(task.spec?.document?.plan.length ?? 0, 'phase', 'phases');
  return version > 1 ? `Version ${version} · ${phases}` : phases;
}
