import type { InitiativePhaseProgress } from './types.ts';

export const NO_PHASE_NAME = 'No phase';

export function resolveInitiativeTotals(progress: readonly InitiativePhaseProgress[]) {
  const total = progress.reduce((sum, phase) => sum + phase.total, 0);
  const shipped = progress.reduce((sum, phase) => sum + phase.shipped, 0);
  const dropped = progress.reduce((sum, phase) => sum + phase.dropped, 0);
  return { total, shipped, dropped, open: total - shipped - dropped };
}

interface PhaseCounts {
  phase: { name: string } | null;
  total: number;
  shipped: number;
  dropped: number;
}

export function describePhaseProgress(progress: PhaseCounts) {
  const name = progress.phase?.name ?? NO_PHASE_NAME;
  if (progress.total === 0) return { name, detail: 'No tasks yet' };
  const planned = progress.total - progress.dropped;
  if (planned === 0) return { name, detail: `${progress.dropped} dropped` };
  const done = `${progress.shipped} of ${planned} shipped`;
  return { name, detail: progress.dropped > 0 ? `${done} · ${progress.dropped} dropped` : done };
}
