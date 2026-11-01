import { describe, expect, it } from 'bun:test';
import type { Gate, Task } from '@shinsa/core';
import {
  describeTaskCounts,
  describeWaitsOn,
  listOpenTaskChoices,
  listTaskGroupSections,
  orderChains,
  resolveTaskGroup,
  selectTaskGroup,
  TASK_GROUP,
  TASK_GROUPS,
} from '@/lib/tasks/groups.ts';
import { createGate, createRepo, createShinsaState, createTask, NOW } from '../../support/state.ts';

function waiting(id: string, waitsOn: string[], overrides: Partial<Task> = {}) {
  return createTask({ id, stage: 'waiting_on_tasks', waitsOn, ...overrides });
}

function chainOf(tasks: Task[], section: Task[] = tasks) {
  return orderChains(createShinsaState({ tasks }), section).map(({ task, depth }) => `${task.id}:${depth}`);
}

describe('resolveTaskGroup', () => {
  function groupFor(gate: Partial<Gate>, task: Partial<Task> = {}) {
    const subject = createTask({ id: 't', ...task });
    const state = createShinsaState({
      tasks: [subject],
      gates: [createGate({ id: 'g', taskId: 't', ...gate })],
    });
    return resolveTaskGroup(state, subject);
  }

  it('files each open decision under what you do at it', () => {
    expect(groupFor({ type: 'merge' })).toBe('merge');
    expect(groupFor({ type: 'review' })).toBe('review');
    expect(groupFor({ type: 'plan' })).toBe('plan');
    expect(groupFor({ type: 'question' })).toBe('answer');
    expect(groupFor({ type: 'result' }, { stage: 'answered' })).toBe('answered');
  });

  it('files a secret request as an answer and a failure or sign-in as paused', () => {
    expect(groupFor({ type: 'secret' })).toBe('answer');
    expect(groupFor({ type: 'failure' })).toBe('paused');
    expect(groupFor({ type: 'sign_in' })).toBe('paused');
  });

  it('lets a failure or a question lead over a decision on the same task', () => {
    const subject = createTask({ id: 't' });
    const state = createShinsaState({
      tasks: [subject],
      gates: [
        createGate({ id: 'decision', taskId: 't', type: 'review' }),
        createGate({ id: 'failure', taskId: 't', type: 'failure' }),
      ],
    });
    expect(resolveTaskGroup(state, subject)).toBe('paused');
  });

  it('files a proposed change as a decision of its own, and an investigation at work as in progress', () => {
    expect(groupFor({ type: 'proposal' }, { stage: 'awaiting_proposal' })).toBe('change');
    expect(groupFor({ type: 'question', status: 'answered' }, { stage: 'investigating' })).toBe('working');
  });

  it('files an operation waiting for your OK after the merge as a decision of its own, not a question', () => {
    expect(groupFor({ type: 'operation' }, { stage: 'awaiting_operation' })).toBe('operation');
  });

  it('files a snoozed task under Snoozed whatever waits on it, until it is finished', () => {
    const snoozed = { snoozed: { at: 1 } };
    expect(groupFor({ type: 'review' }, snoozed)).toBe('snoozed');
    expect(groupFor({ type: 'failure' }, { ...snoozed, backlog: { at: 1 } })).toBe('snoozed');
    expect(groupFor({ type: 'review', status: 'answered' }, { ...snoozed, stage: 'merged' })).toBe('done');
  });

  it('files a backlog task under Backlog while it plans and while its plan waits, but a failure still pauses it', () => {
    const backlog = { backlog: { at: 1 } };
    expect(groupFor({ type: 'plan' }, backlog)).toBe('backlog');
    expect(groupFor({ type: 'failure' }, backlog)).toBe('paused');
    const planning = createTask({ id: 'p', stage: 'planning', ...backlog });
    expect(resolveTaskGroup(createShinsaState({ tasks: [planning] }), planning)).toBe('backlog');
  });

  it('ignores answered gates', () => {
    expect(groupFor({ type: 'review', status: 'answered' })).toBe('working');
  });

  it('puts settled tasks in done or cancelled, even with a gate left open', () => {
    expect(groupFor({ type: 'merge' }, { stage: 'merged' })).toBe('done');
    expect(groupFor({ type: 'merge' }, { stage: 'done' })).toBe('done');
    expect(groupFor({ type: 'merge' }, { stage: 'cancelled' })).toBe('cancelled');
    expect(
      groupFor({ type: 'merge' }, { stage: 'cancelled', duplicate: { of: 'o', by: 'you', why: null } })
    ).toBe('duplicate');
  });

  it('separates tasks waiting on another task from tasks agents are working on', () => {
    const base = createTask({ id: 'base' });
    const blocked = waiting('blocked', ['base']);
    const merging = createTask({ id: 'merging', stage: 'shipping', waitsOn: ['base'] });
    const released = waiting('released', ['gone']);
    const state = createShinsaState({ tasks: [base, blocked, merging, released] });
    expect(resolveTaskGroup(state, base)).toBe('working');
    expect(resolveTaskGroup(state, blocked)).toBe('waiting');
    expect(resolveTaskGroup(state, merging)).toBe('waiting');
    expect(resolveTaskGroup(state, released)).toBe('working');
  });
});

describe('TASK_GROUPS', () => {
  it('lists the sections in to-do order with Snoozed, Done, Duplicates and Cancelled collapsed', () => {
    expect(TASK_GROUPS.map((group) => group.title)).toEqual([
      'Ready to merge',
      'Changes to review',
      'Plan to approve',
      'Change to approve',
      'Operation to confirm',
      'Needs your answer',
      'Answered',
      'Paused',
      'In progress',
      'Waiting on another task',
      'Snoozed',
      'Backlog',
      'Done',
      'Duplicates',
      'Cancelled',
    ]);
    expect(TASK_GROUPS.filter((group) => !group.defaultOpen).map((group) => group.key)).toEqual([
      'snoozed',
      'done',
      'duplicate',
      'cancelled',
    ]);
  });

  it('carries the status tones', () => {
    expect(TASK_GROUP.answer.tone).toBe('blue');
    expect(TASK_GROUP.paused.tone).toBe('orange');
    expect(TASK_GROUP.review.tone).toBe('amber');
    expect(TASK_GROUP.plan.tone).toBe('purple');
    expect(TASK_GROUP.merge.tone).toBe('green');
    expect(TASK_GROUP.working.tone).toBe('blue');
    expect(TASK_GROUP.waiting.tone).toBe('neutral');
  });
});

describe('selectTaskGroup', () => {
  it('finds a section by key and returns null for anything else', () => {
    expect(selectTaskGroup('done')?.title).toBe('Done');
    expect(selectTaskGroup('later')).toBeNull();
    expect(selectTaskGroup(null)).toBeNull();
  });
});

describe('describeWaitsOn', () => {
  const first = createTask({ id: 'a', title: 'Add login' });
  const second = createTask({ id: 'b', title: 'Fix tabs' });
  const third = createTask({ id: 'c', title: 'Ship docs' });
  const fourth = createTask({ id: 'd', title: 'Tidy CSS' });

  it('names one or two tasks it waits on', () => {
    expect(describeWaitsOn([first])).toBe('Waits on “Add login”');
    expect(describeWaitsOn([first, second])).toBe('Waits on “Add login” and “Fix tabs”');
  });

  it('names two and counts the rest', () => {
    expect(describeWaitsOn([first, second, third])).toBe('Waits on “Add login”, “Fix tabs” and 1 more');
    expect(describeWaitsOn([first, second, third, fourth])).toBe(
      'Waits on “Add login”, “Fix tabs” and 2 more'
    );
  });

  it('says when a task it waits on was cancelled', () => {
    const cancelled = createTask({ id: 'x', title: 'Old idea', stage: 'cancelled' });
    expect(describeWaitsOn([first, cancelled])).toBe('“Old idea” was cancelled');
  });
});

describe('orderChains', () => {
  const outside = createTask({ id: 'outside', stage: 'building' });

  it('indents a single chain one level per link', () => {
    const tasks = [outside, waiting('c', ['b']), waiting('b', ['a']), waiting('a', ['outside'])];
    expect(chainOf(tasks, tasks.slice(1))).toEqual(['a:0', 'b:1', 'c:2']);
  });

  it('places fan-out siblings side by side under their parent in priority order', () => {
    const tasks = [
      outside,
      waiting('a', ['outside']),
      waiting('b', ['a'], { createdAt: NOW - 50_000 }),
      waiting('c', ['a'], { createdAt: NOW - 40_000, priority: 'urgent' }),
      waiting('d', ['a'], { createdAt: NOW - 45_000 }),
    ];
    expect(chainOf(tasks, tasks.slice(1))).toEqual(['a:0', 'c:1', 'b:1', 'd:1']);
  });

  it('shows the joining task of a diamond once, under whichever parent is shown second', () => {
    const tasks = [
      outside,
      waiting('a', ['outside']),
      waiting('b', ['a'], { createdAt: NOW - 50_000 }),
      waiting('c', ['a'], { createdAt: NOW - 40_000 }),
      waiting('d', ['b', 'c']),
    ];
    expect(chainOf(tasks, tasks.slice(1))).toEqual(['a:0', 'b:1', 'c:1', 'd:2']);
  });

  it('follows screen order, not priority, when a diamond parent is shown second', () => {
    const tasks = [
      outside,
      waiting('a', ['outside']),
      waiting('b', ['a'], { createdAt: NOW - 50_000 }),
      waiting('c', ['a'], { createdAt: NOW - 40_000, priority: 'urgent' }),
      waiting('d', ['b', 'c']),
    ];
    expect(chainOf(tasks, tasks.slice(1))).toEqual(['a:0', 'c:1', 'b:1', 'd:2']);
  });

  it('keeps the joining task after a parent whose subtree is shown first', () => {
    const tasks = [
      outside,
      waiting('a', ['outside']),
      waiting('b', ['a'], { createdAt: NOW - 50_000 }),
      waiting('c', ['a'], { createdAt: NOW - 40_000 }),
      waiting('e', ['b'], { createdAt: NOW - 30_000 }),
      waiting('d', ['b', 'c'], { createdAt: NOW - 20_000 }),
    ];
    expect(chainOf(tasks, tasks.slice(1))).toEqual(['a:0', 'b:1', 'e:2', 'c:1', 'd:2']);
  });

  it('anchors a diamond under the parent shown last even when its branch has lower priority', () => {
    const tasks = [
      outside,
      waiting('x', ['outside'], { priority: 'high', createdAt: NOW - 90_000 }),
      waiting('y', ['outside'], { createdAt: NOW - 80_000 }),
      waiting('c', ['y'], { createdAt: NOW - 70_000 }),
      waiting('b', ['x'], { createdAt: NOW - 60_000 }),
      waiting('d', ['b', 'c'], { createdAt: NOW - 50_000 }),
    ];
    expect(chainOf(tasks, tasks.slice(1))).toEqual(['x:0', 'b:1', 'y:0', 'c:1', 'd:2']);
  });

  it('measures depth by the longest path when parents sit at different depths', () => {
    const tasks = [outside, waiting('a', ['outside']), waiting('b', ['a']), waiting('d', ['a', 'b'])];
    expect(chainOf(tasks, tasks.slice(1))).toEqual(['a:0', 'b:1', 'd:2']);
  });

  it('starts a chain at a task whose parents are all outside the section', () => {
    const tasks = [outside, waiting('a', ['outside']), waiting('b', ['outside', 'a'])];
    expect(chainOf(tasks, tasks.slice(1))).toEqual(['a:0', 'b:1']);
    expect(chainOf(tasks, [tasks[2] as Task])).toEqual(['b:0']);
  });

  it('starts a chain at a task whose parent was cancelled', () => {
    const tasks = [
      createTask({ id: 'gone', stage: 'cancelled' }),
      waiting('a', ['gone']),
      waiting('b', ['a']),
    ];
    expect(chainOf(tasks, tasks.slice(1))).toEqual(['a:0', 'b:1']);
  });

  it('shows every task of a dependency loop once', () => {
    const tasks = [waiting('a', ['b']), waiting('b', ['a'])];
    const ordered = chainOf(tasks);
    expect(ordered).toHaveLength(2);
    expect(new Set(ordered.map((entry) => entry.split(':')[0]))).toEqual(new Set(['a', 'b']));
  });

  it('returns nothing for an empty section', () => {
    expect(chainOf([])).toEqual([]);
  });
});

describe('listOpenTaskChoices', () => {
  const tasks = [
    createTask({ id: 'self' }),
    createTask({ id: 'later', createdAt: NOW - 10_000 }),
    createTask({ id: 'urgent', priority: 'urgent' }),
    createTask({ id: 'child', waitsOn: ['self'], stage: 'waiting_on_tasks' }),
    createTask({ id: 'grandchild', waitsOn: ['child'], stage: 'waiting_on_tasks' }),
    createTask({ id: 'merged', stage: 'merged' }),
    createTask({ id: 'cancelled', stage: 'cancelled' }),
    createTask({ id: 'home', stage: 'watching', watchHome: true }),
  ];
  const state = createShinsaState({ tasks });

  it('offers open tasks in priority order', () => {
    expect(listOpenTaskChoices(state, null).map((task) => task.id)).toEqual([
      'urgent',
      'self',
      'child',
      'grandchild',
      'later',
    ]);
  });

  it('leaves out the task itself and every task that already waits on it', () => {
    expect(listOpenTaskChoices(state, tasks[0] as Task).map((task) => task.id)).toEqual(['urgent', 'later']);
  });
});

describe('listTaskGroupSections', () => {
  const tasks = [
    createTask({ id: 'old', title: 'Old work', createdAt: NOW - 90_000 }),
    createTask({ id: 'new', title: 'New work', createdAt: NOW - 10_000 }),
    createTask({ id: 'high', title: 'High work', priority: 'high', createdAt: NOW - 5_000 }),
    createTask({ id: 'merged', stage: 'merged', stageChangedAt: NOW - 50_000 }),
    createTask({ id: 'done', stage: 'done', stageChangedAt: NOW - 1_000 }),
    createTask({ id: 'gone', stage: 'cancelled', stageChangedAt: NOW - 1_000 }),
    createTask({
      id: 'copy',
      stage: 'cancelled',
      stageChangedAt: NOW - 2_000,
      duplicate: { of: 'old', by: 'shinsa', why: null },
    }),
    createTask({
      id: 'later-copy',
      stage: 'cancelled',
      stageChangedAt: NOW - 500,
      duplicate: { of: 'old', by: 'you', why: null },
    }),
    createTask({
      id: 'waiter',
      stage: 'waiting_on_tasks',
      waitsOn: ['old'],
      request: 'After the OAuth change',
    }),
    createTask({ id: 'next', stage: 'waiting_on_tasks', waitsOn: ['waiter'], branch: 'feat/next-step' }),
    createTask({ id: 'review', title: 'Review me' }),
    createTask({ id: 'home', stage: 'done', watchHome: true }),
  ];
  const state = createShinsaState({
    tasks,
    gates: [createGate({ id: 'g', taskId: 'review', type: 'review' })],
  });

  function ids(status: Parameters<typeof listTaskGroupSections>[2], search = '') {
    return Object.fromEntries(
      listTaskGroupSections(state, search, status).map(({ group, entries }) => [
        group.key,
        entries.map(({ task, depth }) => (depth ? `${task.id}:${depth}` : task.id)),
      ])
    );
  }

  it('lists every section in order, sorting by priority then oldest and settled tasks newest first', () => {
    expect(ids(null)).toEqual({
      merge: [],
      review: ['review'],
      plan: [],
      change: [],
      operation: [],
      answer: [],
      answered: [],
      paused: [],
      working: ['high', 'old', 'new'],
      waiting: ['waiter', 'next:1'],
      backlog: [],
      snoozed: [],
      done: ['done', 'merged'],
      duplicate: ['later-copy', 'copy'],
      cancelled: ['gone'],
    });
  });

  it('shows only the section picked as a status filter', () => {
    expect(ids('done')).toEqual({ done: ['done', 'merged'] });
  });

  it('matches the search against title, request and branch, ignoring case and spaces around it', () => {
    expect(ids('working', '  WORK ')).toEqual({ working: ['high', 'old', 'new'] });
    expect(ids('waiting', 'oauth')).toEqual({ waiting: ['waiter'] });
    expect(ids('waiting', 'feat/next')).toEqual({ waiting: ['next'] });
    expect(ids(null, 'nothing like this').working).toEqual([]);
  });
});

describe('listTaskGroupSections search by repository', () => {
  it('finds a task by its repository name, so a repository chip’s Show its tasks lists them', () => {
    const state = createShinsaState({
      tasks: [createTask({ id: 'web', repoId: 'paywall-next' }), createTask({ id: 'other' })],
      repos: [createRepo({ id: 'paywall-next' })],
    });
    const working = listTaskGroupSections(state, 'paywall-next', 'working')[0]?.entries.map(
      ({ task }) => task.id
    );
    expect(working).toEqual(['web']);
  });
});

describe('describeTaskCounts', () => {
  it('counts open tasks and finished ones, leaving cancelled tasks and watch homes out of both', () => {
    const state = createShinsaState({
      tasks: [
        createTask({ id: 'a' }),
        createTask({ id: 'b', stage: 'waiting_on_tasks' }),
        createTask({ id: 'c', stage: 'merged' }),
        createTask({ id: 'd', stage: 'done' }),
        createTask({ id: 'e', stage: 'cancelled' }),
        createTask({ id: 'home', stage: 'watching', watchHome: true }),
        createTask({ id: 'rested', stage: 'done', watchHome: true }),
      ],
    });
    expect(describeTaskCounts(state)).toBe('2 open · 2 done');
    expect(describeTaskCounts(createShinsaState({}))).toBe('0 open · 0 done');
  });
});

describe('the tasks of a bundle in All tasks', () => {
  it('lists a ready task with the task on top of its bundle, together and bottom first', () => {
    const root = createTask({ id: 'root', stage: 'shipping', bundleReady: { commit: 'a' } });
    const top = createTask({ id: 'top', stage: 'building', stacksOn: 'root', priority: 'urgent' });
    const other = createTask({ id: 'other', stage: 'building', priority: 'high' });
    const state = createShinsaState({ tasks: [root, top, other] });
    expect(resolveTaskGroup(state, root)).toBe('working');
    const working = listTaskGroupSections(state, '', 'working')[0]?.entries.map(({ task }) => task.id);
    expect(working).toEqual(['root', 'top', 'other']);
  });

  it('lists the tasks merging with the bundle under the top task’s merge gate', () => {
    const root = createTask({ id: 'root', stage: 'awaiting_merge' });
    const top = createTask({ id: 'top', stage: 'awaiting_merge', stacksOn: 'root' });
    const state = createShinsaState({
      tasks: [root, top],
      gates: [createGate({ id: 'm', taskId: 'top', type: 'merge' })],
    });
    expect(resolveTaskGroup(state, root)).toBe('merge');
  });

  it('keeps a ready task on its own when nothing open is above it', () => {
    const root = createTask({ id: 'root', stage: 'shipping', bundleReady: { commit: 'a' } });
    const state = createShinsaState({
      tasks: [root, createTask({ id: 'top', stage: 'cancelled', stacksOn: 'root' })],
    });
    expect(resolveTaskGroup(state, root)).toBe('working');
  });
});
