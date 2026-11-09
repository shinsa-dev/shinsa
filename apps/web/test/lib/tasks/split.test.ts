import { describe, expect, it } from 'bun:test';
import type { PlanDocument } from '@shinsa/core';
import { countBundledTasks, countSplitTasks, listSplitParts } from '@/lib/tasks/split.ts';
import { createTask } from '../../support/state.ts';

const DOCUMENT: PlanDocument = {
  goal: 'g',
  phases: [{ title: 'p', detail: 'd' }],
  behaviour: [],
  approach: '',
  files: [],
  outOfScope: [],
  verification: [],
  questions: [],
};

function withSplit(split: PlanDocument['split']) {
  return createTask({
    id: 't',
    stage: 'awaiting_plan',
    plan: { version: 1, body: '', proposedAt: 0, document: { ...DOCUMENT, split } },
  });
}

describe('listSplitParts', () => {
  it('says when each part starts, naming this task or the earlier part', () => {
    const task = withSplit([
      { title: 'Coupons', request: 'Add coupons.', order: 'parallel' },
      { title: 'Receipts', request: 'Send receipts.', order: 'waits_on', on: 0 },
      { title: 'Refunds', request: 'Refund orders.', order: 'stacks_on', on: 1 },
      { title: 'Taxes', request: 'Add taxes.', order: 'waits_on', on: 7 },
      { title: 'Loose', request: 'No target.', order: 'stacks_on' },
    ]);
    expect(listSplitParts(task).map((part) => part.start)).toEqual([
      'Starts now',
      'Waits on this task',
      'Stacks on Coupons',
      'Waits on part 7',
      'Starts now',
    ]);
    expect(listSplitParts(task)[0]).toEqual({
      title: 'Coupons',
      request: 'Add coupons.',
      start: 'Starts now',
    });
  });

  it('lists nothing for a plan without a split or a task without a plan', () => {
    expect(listSplitParts(withSplit(undefined))).toEqual([]);
    expect(listSplitParts(createTask({ id: 't' }))).toEqual([]);
  });
});

describe('countSplitTasks', () => {
  it('counts this task with its parts, and nothing without a split', () => {
    expect(countSplitTasks(withSplit([{ title: 'A', request: 'a', order: 'parallel' }]))).toBe(2);
    expect(countSplitTasks(withSplit([]))).toBe(0);
    expect(countSplitTasks(createTask({ id: 't' }))).toBe(0);
  });
});

describe('countBundledTasks', () => {
  it('counts this task with the parts whose stack leads back to it', () => {
    expect(
      countBundledTasks(
        withSplit([
          { title: 'A', request: 'a', order: 'stacks_on', on: 0 },
          { title: 'B', request: 'b', order: 'stacks_on', on: 1 },
          { title: 'C', request: 'c', order: 'parallel' },
          { title: 'D', request: 'd', order: 'stacks_on', on: 3 },
          { title: 'E', request: 'e', order: 'waits_on', on: 0 },
          { title: 'F', request: 'f', order: 'stacks_on', on: 9 },
          { title: 'G', request: 'g', order: 'stacks_on' },
        ])
      )
    ).toBe(3);
  });

  it('counts nothing when no part stacks on this task, or without a split', () => {
    expect(countBundledTasks(withSplit([{ title: 'A', request: 'a', order: 'parallel' }]))).toBe(0);
    expect(countBundledTasks(createTask({ id: 't' }))).toBe(0);
  });
});
