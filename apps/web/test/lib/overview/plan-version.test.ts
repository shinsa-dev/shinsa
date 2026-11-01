import { describe, expect, it } from 'bun:test';
import { describePlanEyebrow, resolvePlanChanges, selectPlanRevision } from '@/lib/overview/plan-version.ts';
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

describe('resolvePlanChanges', () => {
  it('has nothing for a first plan or no plan', () => {
    expect(resolvePlanChanges(createTask({ id: 't' }))).toEqual([]);
    const first = createTask({ id: 't', plan: { version: 1, body: '', document: DOCUMENT, proposedAt: 1 } });
    expect(resolvePlanChanges(first)).toEqual([]);
    expect(describePlanEyebrow(first)).toBe('0 phases');
    expect(describePlanEyebrow(createTask({ id: 't' }))).toBe('0 phases');
  });

  it('lists what a revision changed', () => {
    const changes = [{ kind: 'phase_added' as const, title: 'Retry' }, { kind: 'approach' as const }];
    const task = createTask({
      id: 't',
      plan: { version: 3, body: '', document: DOCUMENT, proposedAt: 1, changes },
    });
    expect(resolvePlanChanges(task)).toEqual(changes);
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

  it('has no changes for a revision that recorded none', () => {
    const task = createTask({ id: 't', plan: { version: 2, body: '', document: DOCUMENT, proposedAt: 1 } });
    expect(resolvePlanChanges(task)).toEqual([]);
  });
});

describe('selectPlanRevision', () => {
  it('finds the latest revision a chat hand-over proposed, by its goal', () => {
    const task = createTask({
      id: 't',
      planHistory: [
        { version: 1, body: '', document: DOCUMENT, proposedAt: 1 },
        { version: 2, body: '', document: { ...DOCUMENT, goal: 'Retry it.' }, proposedAt: 2 },
      ],
      plan: { version: 3, body: '', document: DOCUMENT, proposedAt: 3 },
    });
    expect(selectPlanRevision(task, 'Retry it.', null)?.version).toBe(2);
    expect(selectPlanRevision(task, 'Ship it.', null)?.version).toBe(3);
    expect(selectPlanRevision(task, 'Something else.', null)).toBeNull();
    expect(selectPlanRevision(task, 'Something else.', 2)).toBeNull();
    expect(selectPlanRevision(task, null, 1)).toBeNull();
    expect(selectPlanRevision(null, 'Ship it.', 1)).toBeNull();
    expect(selectPlanRevision(createTask({ id: 't' }), 'Ship it.', 1)).toBeNull();
  });

  it('tells apart revisions that kept the goal by when each was proposed', () => {
    const task = createTask({
      id: 't',
      planHistory: [{ version: 1, body: '', document: DOCUMENT, proposedAt: 1_000 }],
      plan: { version: 2, body: '', document: DOCUMENT, proposedAt: 60_000 },
    });
    expect(selectPlanRevision(task, 'Ship it.', 990)?.version).toBe(1);
    expect(selectPlanRevision(task, 'Ship it.', 59_990)?.version).toBe(2);
  });
});
