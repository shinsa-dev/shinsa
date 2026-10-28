import { describe, expect, it } from 'bun:test';
import { describePlanEyebrow, listRevisionChanges, resolvePlanVersion } from '@/lib/overview/plan-version.ts';
import { createTask } from '../../support/state.ts';

const DOCUMENT = {
  goal: 'Ship it.',
  phases: [],
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
    const first = createTask({ id: 't', plan: { version: 1, body: '', document: DOCUMENT, proposedAt: 1 } });
    expect(resolvePlanVersion(first)).toBeNull();
    expect(describePlanEyebrow(first)).toBe('0 phases');
    expect(describePlanEyebrow(createTask({ id: 't' }))).toBe('0 phases');
  });

  it('describes a revision: its summary, its changes and the feedback that asked for it', () => {
    const task = createTask({
      id: 't',
      plan: {
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
      changes: [{ kind: 'phase_added', title: 'Retry' }, { kind: 'approach' }],
      feedback: 'Retry the export.',
    });
    expect(describePlanEyebrow(task)).toBe('Version 3 · 0 phases');
    const phased = createTask({
      id: 't',
      plan: {
        version: 1,
        body: '',
        document: { ...DOCUMENT, phases: [{ title: 'A', detail: '' }] },
        proposedAt: 1,
      },
    });
    expect(describePlanEyebrow(phased)).toBe('1 phase');
  });

  it('has no summary, changes or feedback for a revision without them', () => {
    const task = createTask({ id: 't', plan: { version: 2, body: '', document: DOCUMENT, proposedAt: 1 } });
    expect(resolvePlanVersion(task)).toEqual({ summary: null, changes: [], feedback: null });
  });
});

describe('listRevisionChanges', () => {
  it('finds the changes of the revision a chat hand-over proposed, by its summary', () => {
    const added = [{ kind: 'phase_added' as const, title: 'Retry' }];
    const changed = [{ kind: 'phase_changed' as const, title: 'Retry' }];
    const task = createTask({
      id: 't',
      planHistory: [
        { version: 1, body: '', document: DOCUMENT, proposedAt: 1 },
        {
          version: 2,
          body: '',
          document: DOCUMENT,
          proposedAt: 2,
          changeSummary: 'Added a retry.',
          changes: added,
        },
      ],
      plan: {
        version: 3,
        body: '',
        document: DOCUMENT,
        proposedAt: 3,
        changeSummary: 'Reworked it.',
        changes: changed,
      },
    });
    expect(listRevisionChanges(task, ' Added a retry. ')).toEqual(added);
    expect(listRevisionChanges(task, 'Reworked it.')).toEqual(changed);
    expect(listRevisionChanges(task, 'Something else.')).toEqual([]);
    expect(listRevisionChanges(task, null)).toEqual([]);
    expect(listRevisionChanges(null, 'Reworked it.')).toEqual([]);
    expect(listRevisionChanges(createTask({ id: 't' }), 'Reworked it.')).toEqual([]);
  });

  it('has no changes for a revision that recorded none', () => {
    const task = createTask({
      id: 't',
      plan: { version: 2, body: '', document: DOCUMENT, proposedAt: 2, changeSummary: 'Tightened it.' },
    });
    expect(listRevisionChanges(task, 'Tightened it.')).toEqual([]);
  });
});
