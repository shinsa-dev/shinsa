import { expect } from 'bun:test';
import { resolveTaskPipeline, type ShinsaState } from '../../src/index.ts';

export function assertCheckInvariants(state: ShinsaState) {
  for (const task of Object.values(state.tasks)) {
    const checks = task.checks ?? [];
    const ids = checks.map((check) => check.id);
    expect(new Set(ids).size, `${task.id} has two checks with one id`).toBe(ids.length);
    if (!resolveTaskPipeline(task).includes('build')) expect(checks, `${task.id} builds nothing`).toEqual([]);
    const phases = task.plan?.document?.phases.length ?? 0;
    for (const check of checks) {
      expect(check.source).not.toBe('repo');
      expect(check.phases.length, `${task.id} ${check.id} covers no phase`).toBeGreaterThan(0);
      expect(
        Math.max(...check.phases),
        `${task.id} ${check.id} covers a phase the plan lacks`
      ).toBeLessThanOrEqual(Math.max(1, phases));
    }
    for (const result of task.checkResults ?? []) {
      if (result.id.startsWith('c'))
        expect(ids, `${task.id} keeps a result of a removed check`).toContain(result.id);
    }
  }
}
