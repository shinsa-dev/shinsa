import { describe, expect, test } from 'bun:test';
import { describePlanChange, resolvePlanChanges, type PlanDocument } from '../../src/report/index.ts';
import { SPEC } from '../harness.ts';

function revise(patch: Partial<PlanDocument>): PlanDocument {
  return { ...SPEC, ...patch };
}

describe('resolvePlanChanges', () => {
  test('has nothing to say about a first plan or an unchanged one', () => {
    expect(resolvePlanChanges(null, SPEC)).toEqual([]);
    expect(resolvePlanChanges(SPEC, null)).toEqual([]);
    expect(resolvePlanChanges(SPEC, revise({ goal: '  ship IT. ' }))).toEqual([]);
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
    expect(resolvePlanChanges(SPEC, after)).toEqual([
      { kind: 'goal' },
      { kind: 'phase_changed', title: 'Fix and verify' },
      { kind: 'phase_added', title: 'Add a test' },
      { kind: 'phase_removed', title: 'Find the overflow' },
      { kind: 'approach' },
    ]);
  });

  test('notices phases that only moved', () => {
    const after = revise({ plan: [SPEC.plan[1], SPEC.plan[0]].filter((step) => step !== undefined) });
    expect(resolvePlanChanges(SPEC, after)).toEqual([{ kind: 'phases_reordered' }]);
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

describe('describePlanChange', () => {
  test('says each change in a short sentence', () => {
    expect(
      [
        { kind: 'goal' } as const,
        { kind: 'approach' } as const,
        { kind: 'phase_added', title: 'Add a test' } as const,
        { kind: 'phase_removed', title: 'Find it' } as const,
        { kind: 'phase_changed', title: 'Fix it' } as const,
        { kind: 'phases_reordered' } as const,
        { kind: 'files', added: 1, removed: 0 } as const,
        { kind: 'files', added: 0, removed: 2 } as const,
        { kind: 'files', added: 2, removed: 1 } as const,
      ].map(describePlanChange)
    ).toEqual([
      'Changed the goal',
      'Changed the approach',
      'Added the phase “Add a test”',
      'Dropped the phase “Find it”',
      'Reworked the phase “Fix it”',
      'Put the phases in a new order',
      'Files: 1 new file',
      'Files: 2 files dropped',
      'Files: 2 new files, 1 file dropped',
    ]);
  });
});
