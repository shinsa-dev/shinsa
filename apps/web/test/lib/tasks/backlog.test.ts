import { describe, expect, it } from 'bun:test';
import type { PlanSplitPart } from '@shinsa/core';
import { describePlanCard } from '@/lib/tasks/backlog.ts';
import { createTask } from '../../support/state.ts';

describe('describePlanCard', () => {
  it('asks for your go-ahead on a plan that waits for you', () => {
    expect(describePlanCard(createTask({ id: 't', stage: 'awaiting_plan' }))).toEqual({
      title: 'The agent wants your go-ahead on this plan',
      approve: 'Approve plan',
      note: 'Want something different? Say it in the chat and the agent revises it.',
    });
  });

  it('offers to start building a plan kept in the backlog, or to start an operation', () => {
    const parked = createTask({ id: 't', stage: 'awaiting_plan', backlog: { at: 1 } });
    expect(describePlanCard(parked)).toMatchObject({
      title: 'Planned and kept in the backlog',
      approve: 'Start building',
    });
    const operation = {
      ...parked,
      pipeline: ['plan', 'operate'] as Parameters<typeof createTask>[0]['pipeline'],
    };
    expect(describePlanCard(operation).approve).toBe('Start the operation');
  });

  it('offers to start every task of a split, in the backlog too', () => {
    const plan = withParts([
      { title: 'A', request: 'a', order: 'parallel' },
      { title: 'B', request: 'b', order: 'parallel' },
    ]);
    expect(describePlanCard(createTask({ id: 't', stage: 'awaiting_plan', plan }))).toEqual({
      title: 'The agent wants to split this into 3 tasks',
      approve: 'Start 3 tasks',
      note: 'Each other part becomes its own task and plans for itself. To change the parts, say it in the chat.',
    });
    expect(
      describePlanCard(createTask({ id: 't', stage: 'awaiting_plan', plan, backlog: { at: 1 } }))
    ).toMatchObject({
      title: 'Planned as 3 tasks and kept in the backlog',
      approve: 'Start 3 tasks',
    });
  });

  it('calls a split whose parts all stack on this task a bundle, in the backlog too', () => {
    const plan = withParts([
      { title: 'A', request: 'a', order: 'stacks_on', on: 0 },
      { title: 'B', request: 'b', order: 'stacks_on', on: 1 },
    ]);
    expect(describePlanCard(createTask({ id: 't', stage: 'awaiting_plan', plan }))).toEqual({
      title: 'The agent wants to split this into a 3-task bundle',
      approve: 'Start 3-task bundle',
      note: 'The parts stack on this task and merge as one. To change them, say it in the chat.',
    });
    expect(
      describePlanCard(createTask({ id: 't', stage: 'awaiting_plan', plan, backlog: { at: 1 } }))
    ).toMatchObject({
      title: 'Planned as a 3-task bundle and kept in the backlog',
      approve: 'Start 3-task bundle',
    });
  });

  it('says how many tasks of a mixed split form the bundle', () => {
    const plan = withParts([
      { title: 'A', request: 'a', order: 'stacks_on', on: 0 },
      { title: 'B', request: 'b', order: 'parallel' },
    ]);
    expect(describePlanCard(createTask({ id: 't', stage: 'awaiting_plan', plan }))).toMatchObject({
      title: 'The agent wants to split this into 3 tasks, 2 in a bundle',
      approve: 'Start 3 tasks',
    });
    expect(
      describePlanCard(createTask({ id: 't', stage: 'awaiting_plan', plan, backlog: { at: 1 } })).title
    ).toBe('Planned as 3 tasks, 2 in a bundle and kept in the backlog');
  });
});

function withParts(split: PlanSplitPart[]) {
  return {
    version: 1,
    body: '',
    proposedAt: 0,
    document: {
      goal: 'g',
      phases: [],
      behaviour: [],
      approach: '',
      files: [],
      outOfScope: [],
      verification: [],
      questions: [],
      split,
    },
  };
}
