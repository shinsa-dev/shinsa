import { describe, expect, test } from 'bun:test';
import { type PlanDocument, resolvePhaseChange, resolvePlanChanges } from '../../src/report/index.ts';
import { PLAN } from '../harness.ts';

function revise(patch: Partial<PlanDocument>): PlanDocument {
  return { ...PLAN, ...patch };
}

describe('resolvePlanChanges', () => {
  test('has nothing to say about a first plan or an unchanged one', () => {
    expect(resolvePlanChanges(null, PLAN)).toEqual([]);
    expect(resolvePlanChanges(PLAN, null)).toEqual([]);
    expect(resolvePlanChanges(PLAN, revise({ goal: '  ship IT. ' }))).toEqual([]);
  });

  test('names the goal, the approach and every phase that came, went or changed', () => {
    const after = revise({
      goal: 'Ship it safely.',
      approach: 'Behind a flag.',
      phases: [
        { title: 'Fix and verify', detail: 'Clamp the width, then check both themes.' },
        { title: 'Add a test', detail: 'Cover the overflow.' },
      ],
    });
    expect(resolvePlanChanges(PLAN, after)).toEqual([
      { kind: 'goal' },
      { kind: 'phase_changed', title: 'Fix and verify' },
      { kind: 'phase_added', title: 'Add a test' },
      { kind: 'phase_removed', title: 'Find the overflow' },
      { kind: 'approach' },
    ]);
  });

  test('notices phases that only moved', () => {
    const after = revise({ phases: [PLAN.phases[1], PLAN.phases[0]].filter((phase) => phase !== undefined) });
    expect(resolvePlanChanges(PLAN, after)).toEqual([{ kind: 'phases_reordered' }]);
  });

  test('counts files added and dropped', () => {
    const before = revise({ files: [{ path: 'a.ts', change: 'x' }] });
    const after = revise({
      files: [
        { path: 'b.ts', change: 'y' },
        { path: 'c.ts', change: 'z' },
      ],
    });
    expect(resolvePlanChanges(before, after)).toEqual([{ kind: 'files', added: 2, removed: 1 }]);
  });
});

describe('resolvePhaseChange', () => {
  test('says whether a phase is new or reworked, matching its title loosely', () => {
    const changes = [
      { kind: 'phase_added', title: 'Add a test' } as const,
      { kind: 'phase_changed', title: 'Fix it' } as const,
      { kind: 'phase_removed', title: 'Find it' } as const,
      { kind: 'goal' } as const,
    ];
    expect(resolvePhaseChange(changes, ' add a  TEST ')).toBe('added');
    expect(resolvePhaseChange(changes, 'Fix it')).toBe('changed');
    expect(resolvePhaseChange(changes, 'Find it')).toBeNull();
    expect(resolvePhaseChange(undefined, 'Fix it')).toBeNull();
  });
});
