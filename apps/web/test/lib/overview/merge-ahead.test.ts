import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { MergeStep, Task } from '@shinsa/core';
import {
  describeMergeAhead,
  KEEP_MERGE_GATE_LABEL,
  requestKeepMergeGate,
} from '@/lib/overview/merge-ahead.ts';
import { spyOnCommands } from '../../support/commands.ts';
import { createTask } from '../../support/state.ts';

const STEP: MergeStep = {
  when: 'pre_merge',
  kind: 'env',
  title: 'Set A',
  detail: 'In production.',
  command: null,
};

function withSteps(steps: MergeStep[]): Task {
  return createTask({
    id: 't',
    mergeAhead: true,
    phaseReports: [
      {
        index: 0,
        summary: 'Done.',
        spots: [],
        judgementCalls: [],
        walkthrough: { approach: 'a', flow: 'f', risks: [], testing: { automated: [], manual: [] }, steps },
        at: 1,
      },
    ],
  });
}

describe('merging once ready', () => {
  let spies: ReturnType<typeof spyOnCommands>;

  beforeEach(() => {
    spies = spyOnCommands();
  });

  afterEach(() => {
    spies.restore();
  });

  it('says nothing unless you chose to merge once ready on an open task', () => {
    expect(describeMergeAhead(createTask({ id: 't' }))).toBeNull();
    expect(describeMergeAhead(createTask({ id: 't', mergeAhead: true, stage: 'merged' }))).toBeNull();
  });

  it('says it merges by itself once ready, or once you tick the steps before the merge', () => {
    expect(describeMergeAhead(createTask({ id: 't', mergeAhead: true, stage: 'shipping' }))).toBe(
      'You chose to merge once ready: it merges by itself once CI is green, nothing conflicts and no comment is unread.'
    );
    expect(describeMergeAhead(withSteps([STEP]))).toBe(
      'You chose to merge once ready: it merges as soon as you tick the step before the merge.'
    );
    expect(describeMergeAhead(withSteps([STEP, { ...STEP, title: 'Set B' }]))).toBe(
      'You chose to merge once ready: it merges as soon as you tick the 2 steps before the merge.'
    );
  });

  it('keeps the merge gate when you ask', async () => {
    expect(KEEP_MERGE_GATE_LABEL).toBe('Keep the merge gate');
    await requestKeepMergeGate(createTask({ id: 't' }));
    expect(spies.sent.mock.calls).toEqual([
      [{ type: 'task.keep_merge_gate', taskId: 't' }, 'Kept the merge gate.'],
    ]);
  });
});
