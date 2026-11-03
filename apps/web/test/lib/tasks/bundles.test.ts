import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { canChangeStack, ENGINE_BASELINE_COMMANDS, resolveEngineInfo } from '@shinsa/core';
import {
  describeBundleNote,
  describeBundleParents,
  describeBundleProgress,
  describeBundleWait,
  isMergingWithBundle,
  listBundleRows,
  listStackChoices,
  resolveBundleMemberState,
  selectBundleRoot,
  stackOnTask,
  toggleStack,
  unstackTask,
} from '@/lib/tasks/bundles.ts';
import { spyOnCommands } from '../../support/commands.ts';
import { spyOnEngine } from '../../support/engine.ts';
import { createPullRequest } from '../../support/pull-request.ts';
import { createGate, createRepo, createShinsaState, createTask } from '../../support/state.ts';

const READY = { commit: 'abc' };

function createBundle() {
  const root = createTask({
    id: 'root',
    title: 'Add the schema',
    repoId: 'app',
    stage: 'shipping',
    bundleReady: READY,
    pullRequest: createPullRequest({ number: 41 }),
  });
  const middle = createTask({
    id: 'middle',
    title: 'Add the API',
    repoId: 'app',
    stage: 'building',
    stacksOn: ['root'],
  });
  const top = createTask({
    id: 'top',
    title: 'Add the screen',
    repoId: 'app',
    stage: 'waiting_on_tasks',
    stacksOn: ['middle'],
  });
  return { root, middle, top };
}

describe('the members of a bundle', () => {
  it('lists the bundle bottom first, each with its state, marking the task you are on', () => {
    const { root, middle, top } = createBundle();
    const state = createShinsaState({ tasks: [root, middle, top], repos: [createRepo({ id: 'app' })] });
    const rows = listBundleRows(state, middle);
    expect(rows.map((row) => [row.task.id, row.state, row.current, row.depth])).toEqual([
      ['root', 'ready', false, 0],
      ['middle', 'working', true, 1],
      ['top', 'waiting', false, 2],
    ]);
    expect(describeBundleProgress(rows)).toBe('1 of 3 ready');
    expect(describeBundleNote(state, rows)).toBe(
      'Each task builds on the tasks above it, and the ones that build on nothing target main. Once every task is ready and the whole bundle merges into main without conflicts, approving “Add the schema” merges them all, from the bottom up.'
    );
    expect(selectBundleRoot(state, top)?.id).toBe('root');
  });

  it('draws a diamond as a tree: each task under its deepest parent, a task with several parents naming them', () => {
    const at = (hours: number) => Date.UTC(2026, 10, 3, hours);
    const a = createTask({ id: 'a', title: 'A', repoId: 'app', createdAt: at(1) });
    const b = createTask({ id: 'b', title: 'B', repoId: 'app', stacksOn: ['a'], createdAt: at(2) });
    const c = createTask({ id: 'c', title: 'C', repoId: 'app', stacksOn: ['a'], createdAt: at(3) });
    const d = createTask({ id: 'd', title: 'D', repoId: 'app', stacksOn: ['a'], createdAt: at(4) });
    const f = createTask({ id: 'f', title: 'F', repoId: 'app', stacksOn: ['b', 'c', 'd'], createdAt: at(5) });
    const e = createTask({ id: 'e', title: 'E', repoId: 'app', stacksOn: ['f'], createdAt: at(6) });
    const g = createTask({ id: 'g', title: 'G', repoId: 'app', createdAt: at(7) });
    const h = createTask({ id: 'h', title: 'H', repoId: 'app', stacksOn: ['g', 'e'], createdAt: at(8) });
    const state = createShinsaState({ tasks: [h, e, f, d, c, b, a, g] });
    const rows = listBundleRows(state, f);
    expect(rows.map((row) => [row.task.id, row.depth, row.parents.map((parent) => parent.id)])).toEqual([
      ['a', 0, []],
      ['b', 1, []],
      ['c', 1, []],
      ['d', 1, []],
      ['f', 2, ['b', 'c', 'd']],
      ['e', 3, []],
      ['h', 4, ['g', 'e']],
      ['g', 0, []],
    ]);
    expect(describeBundleParents(rows[4]?.parents ?? [])).toBe('Builds on “B”, “C” and “D”');
    expect(describeBundleParents(rows[6]?.parents ?? [])).toBe('Builds on “G” and “E”');
    expect(selectBundleRoot(state, h)?.id).toBe('a');
  });

  it('has no rows for a task outside any bundle', () => {
    const lone = createTask({ id: 'lone' });
    const state = createShinsaState({ tasks: [lone] });
    expect(listBundleRows(state, lone)).toEqual([]);
    expect(selectBundleRoot(state, lone)).toBeNull();
  });

  it('reads each state a member can be in', () => {
    const parent = createTask({ id: 'p', stage: 'awaiting_merge' });
    const child = createTask({ id: 'c', stage: 'awaiting_merge', stacksOn: ['p'] });
    const gated = createTask({ id: 'g', stage: 'awaiting_merge', stacksOn: ['c'] });
    const state = createShinsaState({
      tasks: [parent, child, gated],
      gates: [createGate({ id: 'm', taskId: 'g', type: 'merge' })],
    });
    expect(resolveBundleMemberState(state, parent)).toBe('merging');
    expect(isMergingWithBundle(state, parent)).toBe(true);
    expect(resolveBundleMemberState(state, gated)).toBe('ready');
    expect(isMergingWithBundle(state, gated)).toBe(false);
    expect(isMergingWithBundle(state, createTask({ id: 'alone', stage: 'awaiting_merge' }))).toBe(false);
    expect(resolveBundleMemberState(state, createTask({ id: 'x', stage: 'merged' }))).toBe('merged');
    expect(resolveBundleMemberState(state, createTask({ id: 'y', stage: 'cancelled' }))).toBe('cancelled');
    expect(resolveBundleMemberState(state, createTask({ id: 'z', stage: 'triage' }))).toBe('waiting');
  });

  it('says the bundle merged once nothing in it is left open, on the default branch when it has no repository', () => {
    const root = createTask({ id: 'root', stage: 'merged' });
    const top = createTask({ id: 'top', stage: 'merged', stacksOn: ['root'] });
    const state = createShinsaState({ tasks: [root, top] });
    expect(describeBundleNote(state, listBundleRows(state, top))).toBe(
      'The bundle merged into the default branch.'
    );
  });
});

describe('listStackChoices', () => {
  let engine: ReturnType<typeof spyOnEngine>;

  beforeEach(() => {
    engine = spyOnEngine();
  });

  afterEach(() => {
    engine.mockRestore();
  });

  it('offers nothing on an engine that cannot stack yet', () => {
    engine.mockReturnValue({ ...resolveEngineInfo('1.0.0'), commands: [...ENGINE_BASELINE_COMMANDS] });
    const subject = createTask({ id: 'self', repoId: 'app', stage: 'planning' });
    const state = createShinsaState({ tasks: [subject, createTask({ id: 'open', repoId: 'app' })] });
    expect(listStackChoices(state, subject)).toEqual([]);
  });

  it('offers open tasks in the same repository that open a pull request, even ones others stack on', () => {
    const subject = createTask({ id: 'self', repoId: 'app', stage: 'planning' });
    const state = createShinsaState({
      tasks: [
        subject,
        createTask({ id: 'open', repoId: 'app' }),
        createTask({ id: 'no-repo' }),
        createTask({ id: 'elsewhere', repoId: 'other' }),
        createTask({ id: 'question', repoId: 'app', pipeline: ['answer'] }),
        createTask({ id: 'merged', repoId: 'app', stage: 'merged' }),
        createTask({ id: 'taken', repoId: 'app' }),
        createTask({ id: 'on-taken', repoId: 'app', stage: 'triage', stacksOn: ['taken'] }),
        createTask({ id: 'dependent', repoId: 'app', stage: 'waiting_on_tasks', waitsOn: ['self'] }),
      ],
    });
    expect(
      listStackChoices(state, subject)
        .map((task) => task.id)
        .sort()
    ).toEqual(['no-repo', 'on-taken', 'open', 'taken']);
  });

  it('offers only tasks in the repository named, for a new task stacking on a task there already', () => {
    const state = createShinsaState({
      tasks: [
        createTask({ id: 'here', repoId: 'app' }),
        createTask({ id: 'there', repoId: 'other' }),
        createTask({ id: 'anywhere' }),
      ],
    });
    expect(
      listStackChoices(state, null, 'app')
        .map((task) => task.id)
        .sort()
    ).toEqual(['anywhere', 'here']);
  });

  it('lists the task it already stacks on first, and offers a new task every open one', () => {
    const subject = createTask({ id: 'self', stage: 'triage', stacksOn: ['parent'] });
    const parent = createTask({ id: 'parent' });
    const urgent = createTask({ id: 'urgent', priority: 'urgent' });
    const state = createShinsaState({ tasks: [subject, urgent, parent] });
    expect(listStackChoices(state, subject).map((task) => task.id)).toEqual(['parent', 'urgent']);
    expect(listStackChoices(state, null).map((task) => task.id)).toEqual(['urgent', 'self', 'parent']);
  });

  it('offers nothing once the task has started building', () => {
    const subject = createTask({ id: 'self', stage: 'building' });
    const state = createShinsaState({ tasks: [subject, createTask({ id: 'other' })] });
    expect(canChangeStack(subject)).toBe(false);
    expect(listStackChoices(state, subject)).toEqual([]);
    expect(canChangeStack(createTask({ id: 'p', stage: 'awaiting_plan' }))).toBe(true);
    expect(canChangeStack(createTask({ id: 'm', stage: 'merged' }))).toBe(false);
  });
});

describe('stack commands', () => {
  let spies: ReturnType<typeof spyOnCommands>;
  const parent = createTask({ id: 'p', title: 'Add the schema' });

  beforeEach(() => {
    spies = spyOnCommands();
  });

  afterEach(() => {
    spies.restore();
  });

  it('stacks a task on another and takes it out again', async () => {
    const task = createTask({ id: 't', stage: 'triage' });
    await stackOnTask(task, parent);
    expect(spies.sent).toHaveBeenCalledWith(
      { type: 'task.stack_on_tasks', taskId: 't', stacksOn: ['p'] },
      'Stacked on “Add the schema”.'
    );
    await unstackTask(task);
    expect(spies.sent).toHaveBeenCalledWith(
      { type: 'task.stack_on_tasks', taskId: 't', stacksOn: [] },
      'Taken out of the bundle.'
    );
  });

  it('adds a second task to stack on, and picking one of several takes only that one out', async () => {
    const api = createTask({ id: 'q', title: 'Add the API' });
    await toggleStack(createTask({ id: 't', stacksOn: ['p'] }), api);
    expect(spies.sent).toHaveBeenLastCalledWith(
      { type: 'task.stack_on_tasks', taskId: 't', stacksOn: ['p', 'q'] },
      'Stacked on “Add the API”.'
    );
    await toggleStack(createTask({ id: 't', stacksOn: ['p', 'q'] }), parent);
    expect(spies.sent).toHaveBeenLastCalledWith(
      { type: 'task.stack_on_tasks', taskId: 't', stacksOn: ['q'] },
      'No longer stacked on “Add the schema”.'
    );
  });

  it('toggles: picking the task it stacks on takes it out', async () => {
    await toggleStack(createTask({ id: 't', stacksOn: ['p'] }), parent);
    expect(spies.sent).toHaveBeenLastCalledWith(
      { type: 'task.stack_on_tasks', taskId: 't', stacksOn: [] },
      'Taken out of the bundle.'
    );
    await toggleStack(createTask({ id: 't' }), parent);
    expect(spies.sent).toHaveBeenLastCalledWith(
      { type: 'task.stack_on_tasks', taskId: 't', stacksOn: ['p'] },
      'Stacked on “Add the schema”.'
    );
  });
});

describe('describeBundleWait', () => {
  it('says what a ready task above waits for: the root getting ready, then your approval on it, then the merge', () => {
    const root = createTask({ id: 'root', title: 'Add the schema', stage: 'fixing' });
    const top = createTask({ id: 'top', stage: 'shipping', stacksOn: ['root'], bundleReady: READY });
    const working = createShinsaState({ tasks: [root, top] });
    expect(describeBundleWait(working, top)).toBe('Merges with its bundle once “Add the schema” is ready');
    const gated = createShinsaState({
      tasks: [{ ...root, stage: 'awaiting_merge' }, top],
      gates: [createGate({ id: 'm', taskId: 'root', type: 'merge' })],
    });
    expect(describeBundleWait(gated, top)).toBe('Merges when you approve the bundle on “Add the schema”');
    const mergingTop = createTask({ id: 'top', stage: 'awaiting_merge', stacksOn: ['root'] });
    const merging = createShinsaState({ tasks: [{ ...root, stage: 'awaiting_merge' }, mergingTop] });
    expect(describeBundleWait(merging, mergingTop)).toBe('Merging with its bundle');
    expect(describeBundleWait(working, { ...root, bundleReady: READY })).toBeNull();
  });

  it('says nothing for a task that is not ready or has nothing open above it', () => {
    const lone = createTask({ id: 'lone', stage: 'shipping', bundleReady: READY });
    expect(describeBundleWait(createShinsaState({ tasks: [lone] }), lone)).toBeNull();
    const plain = createTask({ id: 'plain' });
    expect(describeBundleWait(createShinsaState({ tasks: [plain] }), plain)).toBeNull();
  });
});
