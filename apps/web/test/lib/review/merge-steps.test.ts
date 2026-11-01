import { describe, expect, it } from 'bun:test';
import { listMergeSteps, type MergeStep, resolveMergeStepKey, type Task } from '@shinsa/core';
import {
  countOpenSteps,
  describeMergeBlock,
  describePostMergeStatus,
  describePostMergeTitle,
  isMergeWait,
  listMergeWaits,
  listTimedSteps,
  MERGE_STEP_KIND,
  MERGE_WAIT_KIND,
  resolveMergeLabel,
  resolveTickBlock,
  resolveWaitBlock,
} from '@/lib/review/merge-steps.ts';
import { createPullRequest } from '../../support/pull-request.ts';
import { createShinsaState, createTask } from '../../support/state.ts';

const STEP: MergeStep = {
  when: 'pre_merge',
  kind: 'env',
  title: 'Set A',
  detail: 'In production.',
  command: null,
};

const STEPS: MergeStep[] = [
  STEP,
  { ...STEP, title: 'Set B' },
  { ...STEP, when: 'post_merge', kind: 'migration', title: 'Migrate', command: 'bun run migrate' },
];

function withSteps(overrides: Partial<Task> = {}, done: string[] = []) {
  return createTask({
    id: 't1',
    phaseReports: [
      {
        index: 0,
        summary: 'Done.',
        spots: [],
        judgementCalls: [],
        walkthrough: {
          approach: 'a',
          flow: 'f',
          risks: [],
          testing: { automated: [], manual: [] },
          steps: STEPS,
        },
        at: 1,
      },
    ],
    mergeStepsDone: done,
    ...overrides,
  });
}

const MERGED = {
  number: 7,
  url: 'u',
  state: 'merged',
  checks: 'passing',
  unresolvedComments: 0,
  mergeable: null,
  updatedAt: 0,
} as const;

const key = (index: number) => resolveMergeStepKey(STEPS[index] as MergeStep);

describe('the steps around the merge', () => {
  it('splits them by when they happen and counts the open ones', () => {
    const task = withSteps({}, [key(0)]);
    expect(listTimedSteps(task, 'pre_merge').map((step) => [step.title, step.done])).toEqual([
      ['Set A', true],
      ['Set B', false],
    ]);
    expect(countOpenSteps(task, 'pre_merge')).toBe(1);
    expect(countOpenSteps(task, 'post_merge')).toBe(1);
    expect(MERGE_STEP_KIND.migration.label).toBe('Migration');
  });

  it('holds the merge until every step before it is ticked, naming how many', () => {
    expect(describeMergeBlock(withSteps())).toBe('Tick the 2 pre-merge steps first');
    expect(describeMergeBlock(withSteps({}, [key(0)]))).toBe('Tick the pre-merge step first');
    expect(describeMergeBlock(withSteps({}, [key(0), key(1)]))).toBeNull();
  });

  it('says how many steps after the merge are left once it merged', () => {
    const merged = withSteps({ stage: 'merged', pullRequest: MERGED });
    expect(describePostMergeStatus(merged)).toBe('Post-merge · 1 step left');
    expect(describePostMergeTitle(merged)).toBe('Merged. 1 step left to do.');
    expect(describePostMergeStatus(withSteps())).toBe('Post-merge · 0 steps left');
  });

  it('lets a step after the merge be ticked only once the pull request merged, and nothing of a cancelled task', () => {
    const [before, , after] = listMergeSteps(withSteps());
    if (!(before && after)) throw new Error('no steps');
    expect(resolveTickBlock(withSteps(), before)).toBeNull();
    expect(resolveTickBlock(withSteps(), after)).toBe('Tick it once the pull request merged');
    expect(resolveTickBlock(withSteps(), { ...after, done: true })).toBeNull();
    const merged = withSteps({ pullRequest: MERGED });
    const [done, , due] = listMergeSteps(merged);
    if (!(done && due)) throw new Error('no steps');
    expect(resolveTickBlock(merged, due)).toBeNull();
    expect(resolveTickBlock(merged, done)).toBe('The merge is done');
    expect(resolveTickBlock(withSteps({ stage: 'cancelled' }), before)).toBe('The task was cancelled');
  });

  it('lists each task the merge waits on as a linked row that ticks itself once that task finishes', () => {
    const docs = createTask({ id: 'docs', title: 'Document the agent login', stage: 'building' });
    const skills = createTask({ id: 'skills', title: 'Teach the skill to log in', stage: 'merged' });
    const dropped = createTask({ id: 'dropped', title: 'Retire the old login', stage: 'cancelled' });
    const task = createTask({ id: 't1', waitsOn: ['docs', 'skills', 'dropped', 'gone'] });
    const waits = listMergeWaits(createShinsaState({ tasks: [docs, skills, dropped, task] }), task);
    expect(waits).toEqual([
      {
        key: 'wait:docs',
        taskId: 'docs',
        kind: 'wait',
        title: 'Merges after [Document the agent login](shinsa://task/docs) finishes',
        detail: null,
        command: null,
        done: false,
      },
      {
        key: 'wait:skills',
        taskId: 'skills',
        kind: 'wait',
        title: 'Merges after [Teach the skill to log in](shinsa://task/skills) finishes',
        detail: null,
        command: null,
        done: true,
      },
      {
        key: 'wait:dropped',
        taskId: 'dropped',
        kind: 'wait',
        title: 'No longer waits for [Retire the old login](shinsa://task/dropped): it was cancelled',
        detail: null,
        command: null,
        done: true,
      },
    ]);
    const [open, finished] = waits;
    if (!(open && finished)) throw new Error('no waits');
    expect(resolveWaitBlock(open)).toBe('Ticks itself once that task finishes');
    expect(resolveWaitBlock(finished)).toBe('That task finished');
    expect(isMergeWait(open)).toBe(true);
    const [step] = listMergeSteps(withSteps());
    if (!step) throw new Error('no step');
    expect(isMergeWait(step)).toBe(false);
    expect(listMergeWaits(createShinsaState({ tasks: [task] }), createTask({ id: 't2' }))).toEqual([]);
  });
});

describe('the bundle on the merge gate', () => {
  it('lists every task above the root as a row that ticks itself once that task is ready', () => {
    const root = createTask({ id: 'root', title: 'Add the schema', stage: 'awaiting_merge', waitsOn: [] });
    const middle = createTask({
      id: 'middle',
      title: 'Add the API',
      stage: 'shipping',
      stacksOn: 'root',
      bundleReady: { commit: 'a' },
      pullRequest: createPullRequest({ number: 41 }),
    });
    const above = createTask({ id: 'above', title: 'Add the screen', stage: 'shipping', stacksOn: 'middle' });
    const merged = createTask({ id: 'merged', stage: 'merged', stacksOn: 'above' });
    const waits = listMergeWaits(createShinsaState({ tasks: [root, middle, above, merged] }), root);
    expect(waits).toEqual([
      {
        key: 'bundle:middle',
        taskId: 'middle',
        kind: 'bundle',
        title: '[Add the API](shinsa://task/middle) merges with this one',
        detail: null,
        command: null,
        done: true,
      },
      {
        key: 'bundle:above',
        taskId: 'above',
        kind: 'bundle',
        title: '[Add the screen](shinsa://task/above) merges with this one',
        detail: null,
        command: null,
        done: false,
      },
    ]);
    const [ready, open] = waits;
    if (!(open && ready)) throw new Error('no waits');
    expect(resolveWaitBlock(open)).toBe(
      'Ticks itself once that task is ready and its steps before the merge are ticked'
    );
    expect(resolveWaitBlock(ready)).toBe('That task is ready to merge');
    expect(MERGE_WAIT_KIND.bundle.label).toBe('Bundle');
    const state = createShinsaState({ tasks: [root, middle, above] });
    const stepped = withSteps({
      id: 'middle',
      title: 'Add the API',
      stage: 'shipping',
      stacksOn: 'root',
      bundleReady: { commit: 'a' },
    });
    const held = listMergeWaits(createShinsaState({ tasks: [root, stepped, above] }), root)[0];
    expect(held?.done).toBe(false);
    expect(held?.detail).toBe('Tick its 2 steps before the merge on that task first.');
    expect(resolveMergeLabel(state, root, 'Merge')).toBe('Merge 2 pull requests');
    expect(
      resolveMergeLabel(
        state,
        createTask({ id: 'x', pullRequest: createPullRequest({ number: 7 }) }),
        'Merge'
      )
    ).toBe('Merge #7');
    expect(resolveMergeLabel(state, createTask({ id: 'y' }), 'Merge')).toBe('Merge');
  });
});
