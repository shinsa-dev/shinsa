import { describe, expect, it } from 'bun:test';
import { describePlanEyebrow, resolvePlanVersion } from '@/lib/overview/plan-version.ts';
import { createTask } from '../../support/state.ts';

const DOCUMENT = {
  goal: 'Ship it.',
  plan: [],
  behaviour: [],
  approach: 'Plainly.',
  files: [],
  outOfScope: [],
  verification: [],
  questions: [],
};

describe('resolvePlanVersion', () => {
  it('has nothing for a first plan or no plan', () => {
    expect(resolvePlanVersion(createTask({ id: 't' }))).toBeNull();
    const first = createTask({ id: 't', spec: { version: 1, body: '', document: DOCUMENT, proposedAt: 1 } });
    expect(resolvePlanVersion(first)).toBeNull();
    expect(describePlanEyebrow(first)).toBe('0 phases');
    expect(describePlanEyebrow(createTask({ id: 't' }))).toBe('0 phases');
  });

  it('describes a revision: its summary, the changes in words and the feedback that asked for it', () => {
    const task = createTask({
      id: 't',
      spec: {
        version: 3,
        body: '',
        document: DOCUMENT,
        proposedAt: 1,
        changeSummary: 'Split the export.',
        changes: [{ kind: 'phase_added', title: 'Retry' }, { kind: 'approach' }],
        feedback: 'Retry the export.',
      },
    });
    expect(resolvePlanVersion(task)).toEqual({
      summary: 'Split the export.',
      changes: ['Added the phase “Retry”', 'Changed the approach'],
      feedback: 'Retry the export.',
    });
    expect(describePlanEyebrow(task)).toBe('Version 3 · 0 phases');
    const phased = createTask({
      id: 't',
      spec: {
        version: 1,
        body: '',
        document: { ...DOCUMENT, plan: [{ title: 'A', detail: '' }] },
        proposedAt: 1,
      },
    });
    expect(describePlanEyebrow(phased)).toBe('1 phase');
  });

  it('has nothing to show for a revision without a summary or changes', () => {
    const task = createTask({ id: 't', spec: { version: 2, body: '', document: DOCUMENT, proposedAt: 1 } });
    expect(resolvePlanVersion(task)).toBeNull();
  });
});
