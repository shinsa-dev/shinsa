import { describe, expect, it } from 'bun:test';
import { listPlanEvidenceKinds, resolvePlanParameters } from '@/lib/overview/plan-parameters.ts';

describe('resolvePlanParameters', () => {
  it('names the evidence kinds plainly, in the plan’s order, with the checks, impact and approval', () => {
    expect(
      resolvePlanParameters({
        evidence: ['preview', 'screenshot', 'recording', 'test', 'note'],
        verification: [
          { label: 'Currency tests', command: 'bun test currency', phases: [1, 2] },
          { label: 'Types', command: 'bun run check-types', phases: [] },
        ],
        impact: '  About 400 rows.  ',
        approval: true,
      })
    ).toEqual({
      evidence: ['Preview link', 'Screenshot', 'Recording', 'Linked test', 'Note'],
      checks: [
        { label: 'Currency tests', command: 'bun test currency', phases: 'Phases 1 to 2' },
        { label: 'Types', command: 'bun run check-types', phases: null },
      ],
      impact: 'About 400 rows.',
      approval: true,
    });
  });

  it('is null for a plan without any of them, so nothing is drawn', () => {
    expect(resolvePlanParameters({})).toBeNull();
    expect(
      resolvePlanParameters({ evidence: [], verification: [], impact: '  ', approval: false })
    ).toBeNull();
  });

  it('shows a plan that only asked for your approval', () => {
    expect(resolvePlanParameters({ approval: true })).toEqual({
      evidence: [],
      checks: [],
      impact: null,
      approval: true,
    });
  });
});

describe('listPlanEvidenceKinds', () => {
  it('keeps only the kinds a plan can ask for', () => {
    expect(listPlanEvidenceKinds(['test', 'check', 'video', 'note'])).toEqual(['test', 'note']);
  });
});
