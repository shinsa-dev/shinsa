import { describe, expect, test } from 'bun:test';
import {
  type CommandOf,
  listProjectRepos,
  resolveNextHandle,
  selectTaskByHandle,
  selectTaskByReference,
} from '../../src/index.ts';
import { createHarness, type Harness, registerRepo } from '../harness.ts';

function writeProject(harness: Harness, name: string, key?: string) {
  harness.send({ type: 'project.write', project: { name, color: 'blue', ...(key ? { key } : {}) } });
  return Object.values(harness.state.projects).find((project) => project.name === name)?.id ?? '';
}

function create(harness: Harness, fields: Partial<CommandOf<'task.create'>> = {}) {
  const before = new Set(Object.keys(harness.state.tasks));
  harness.send({ type: 'task.create', request: 'Do the thing', repoId: null, ...fields });
  return Object.keys(harness.state.tasks).find((id) => !before.has(id)) ?? '';
}

function triage(harness: Harness, taskId: string, repoId: string) {
  harness.send({
    type: 'task.triage',
    taskId,
    title: 'Do the thing',
    repoId,
    size: 'small',
    branch: `fix/${taskId}`,
    waitsOn: [],
  });
}

function handleOf(harness: Harness, taskId: string) {
  return harness.task(taskId).handle;
}

describe('task handles', () => {
  test('a task created in a project gets the project’s next number at once', () => {
    const harness = createHarness();
    const projectId = writeProject(harness, 'Superwall', 'SW');
    const first = create(harness, { projectId });
    const second = create(harness, { projectId });
    expect([handleOf(harness, first), handleOf(harness, second)]).toEqual(['SW-1', 'SW-2']);
    expect(harness.task(first).projectId).toBe(projectId);
    expect(harness.state.taskNumbers).toEqual({ SW: 2 });
  });

  test('a task created in a repository’s project is numbered in that project, and keeps its handle at triage', () => {
    const harness = createHarness();
    const repoId = registerRepo(harness);
    const taskId = create(harness, { repoId });
    expect(handleOf(harness, taskId)).toBe('SUP-1');
    triage(harness, taskId, repoId);
    expect(handleOf(harness, taskId)).toBe('SUP-1');
    expect(harness.state.taskNumbers).toEqual({ SUP: 1 });
  });

  test('a task without a project gets its handle at triage from the repository’s project', () => {
    const harness = createHarness();
    const repoId = registerRepo(harness);
    const taskId = create(harness);
    expect(handleOf(harness, taskId)).toBeNull();
    triage(harness, taskId, repoId);
    expect(harness.task(taskId)).toMatchObject({
      handle: 'SUP-1',
      projectId: harness.state.repos[repoId]?.projectId,
    });
  });

  test('a task triaged into a repository without a project is numbered T-n', () => {
    const harness = createHarness();
    const repoId = registerRepo(harness, 'scratch', null);
    const first = create(harness, { projectId: null });
    const second = create(harness);
    triage(harness, first, repoId);
    triage(harness, second, repoId);
    expect([handleOf(harness, first), handleOf(harness, second)]).toEqual(['T-1', 'T-2']);
    expect(harness.task(first).projectId).toBeNull();
  });

  test('a task explicitly without a project is not put in the focus project', () => {
    const harness = createHarness();
    const projectId = writeProject(harness, 'Superwall', 'SW');
    harness.send({ type: 'focus.change', projectId, until: null });
    const taskId = create(harness, { projectId: null });
    expect(harness.task(taskId)).toMatchObject({ projectId: null, handle: null });
  });

  test('without a project or repository, a task joins the project in focus and gets its handle at triage', () => {
    const harness = createHarness();
    const projectId = writeProject(harness, 'Superwall', 'SW');
    const repoId = registerRepo(harness, 'scratch', null);
    harness.send({ type: 'focus.change', projectId, until: harness.now + 100 });
    const taskId = create(harness);
    expect(harness.task(taskId)).toMatchObject({ projectId, handle: null });
    expect(harness.task(taskId).auto.project).toBe(true);
    expect(harness.state.taskNumbers).toEqual({});
    triage(harness, taskId, repoId);
    expect(harness.task(taskId)).toMatchObject({ projectId, handle: 'SW-1' });
    expect(harness.state.taskNumbers).toEqual({ SW: 1 });
  });

  test('a project you pick, or one a repository brings, is not the focus default', () => {
    const harness = createHarness();
    const repoId = registerRepo(harness);
    const focus = writeProject(harness, 'Basket', 'BAS');
    harness.send({ type: 'focus.change', projectId: focus, until: null });
    const picked = create(harness, { projectId: focus });
    const fromRepo = create(harness, { repoId });
    const none = create(harness, { projectId: null });
    expect([picked, fromRepo, none].map((id) => harness.task(id).auto.project)).toEqual([
      false,
      false,
      false,
    ]);
    expect(handleOf(harness, picked)).toBe('BAS-1');
  });

  test('a focus-default task triaged into another project’s repository moves there and is numbered there', () => {
    const harness = createHarness();
    const local = writeProject(harness, 'Local', 'LOC');
    const repoId = registerRepo(harness);
    harness.send({ type: 'focus.change', projectId: local, until: null });
    const taskId = create(harness);
    const result = harness.send({
      type: 'task.triage',
      taskId,
      title: 'Do the thing',
      repoId,
      size: 'small',
      branch: 'fix/thing',
      waitsOn: [],
    });
    const superwall = harness.state.repos[repoId]?.projectId;
    expect(result.events.find((event) => event.type === 'task.triaged')).toMatchObject({
      projectId: superwall,
      handle: 'SUP-1',
    });
    expect(harness.task(taskId)).toMatchObject({ projectId: superwall, handle: 'SUP-1' });
    expect(harness.state.taskNumbers).toEqual({ SUP: 1 });
  });

  test('a project you pick stays when triage binds another project’s repository', () => {
    const harness = createHarness();
    const local = writeProject(harness, 'Local', 'LOC');
    const repoId = registerRepo(harness);
    harness.send({ type: 'focus.change', projectId: local, until: null });
    const taskId = create(harness, { projectId: local });
    triage(harness, taskId, repoId);
    expect(harness.task(taskId)).toMatchObject({ repoId, projectId: local, handle: 'LOC-1' });
    expect(harness.state.taskNumbers).toEqual({ LOC: 1 });
  });

  test('a focus-default task triaged into no repository, or one with no project, stays in the focus project', () => {
    const harness = createHarness();
    const local = writeProject(harness, 'Local', 'LOC');
    const scratch = registerRepo(harness, 'scratch', null);
    harness.send({ type: 'focus.change', projectId: local, until: null });
    const intoScratch = create(harness);
    triage(harness, intoScratch, scratch);
    const sameProject = create(harness);
    const own = registerRepo(harness, 'own', 'Local');
    triage(harness, sameProject, own);
    expect([intoScratch, sameProject].map((id) => harness.task(id))).toMatchObject([
      { projectId: local, handle: 'LOC-1' },
      { projectId: local, handle: 'LOC-2' },
    ]);
  });

  test('a repository’s project wins over the focus project', () => {
    const harness = createHarness();
    const repoId = registerRepo(harness);
    const focus = writeProject(harness, 'Basket', 'BAS');
    harness.send({ type: 'focus.change', projectId: focus, until: null });
    const taskId = create(harness, { repoId });
    expect(handleOf(harness, taskId)).toBe('SUP-1');
  });

  test('a focus that has run out is not a default', () => {
    const harness = createHarness();
    const projectId = writeProject(harness, 'Superwall', 'SW');
    harness.send({ type: 'focus.change', projectId, until: harness.now + 1 });
    harness.advance(10);
    const taskId = create(harness);
    expect(harness.task(taskId)).toMatchObject({ projectId: null, handle: null });
  });

  test('a project that does not exist is refused and creates nothing', () => {
    const harness = createHarness();
    expect(() => create(harness, { projectId: 'gone' })).toThrow('No project gone');
    expect(harness.state.tasks).toEqual({});
  });

  test('numbers count per key: a new key starts at 1, and the old key continues where it stopped', () => {
    const harness = createHarness();
    const projectId = writeProject(harness, 'Superwall', 'SW');
    const first = create(harness, { projectId });
    create(harness, { projectId });
    harness.send({
      type: 'project.write',
      project: { id: projectId, name: 'Superwall', color: 'blue', key: 'SWL' },
    });
    const renamed = create(harness, { projectId });
    expect(handleOf(harness, first)).toBe('SW-1');
    expect(handleOf(harness, renamed)).toBe('SWL-1');
    harness.send({
      type: 'project.write',
      project: { id: projectId, name: 'Superwall', color: 'blue', key: 'SW' },
    });
    const back = create(harness, { projectId });
    expect(handleOf(harness, back)).toBe('SW-3');
    const handles = Object.values(harness.state.tasks).map((task) => task.handle);
    expect(new Set(handles).size).toBe(handles.length);
    expect(harness.state.taskNumbers).toEqual({ SW: 3, SWL: 1 });
  });

  test('the next handle of a project that is gone, or of no project, is T-n', () => {
    const harness = createHarness();
    expect(resolveNextHandle(harness.state, null)).toBe('T-1');
    expect(resolveNextHandle(harness.state, 'gone')).toBe('T-1');
  });
});

describe('finding a task by its handle', () => {
  test('a handle matches in any case, with or without spaces around it', () => {
    const harness = createHarness();
    const projectId = writeProject(harness, 'Superwall', 'SW');
    for (let index = 0; index < 7; index += 1) create(harness, { projectId });
    const seventh = Object.values(harness.state.tasks).find((task) => task.handle === 'SW-7');
    expect(selectTaskByHandle(harness.state, 'sw-7')?.id).toBe(seventh?.id ?? 'missing');
    expect(selectTaskByHandle(harness.state, ' SW-07 ')?.id).toBe(seventh?.id ?? 'missing');
    expect(selectTaskByHandle(harness.state, 'SW-8')).toBeNull();
    expect(selectTaskByHandle(harness.state, 'Fix SW-7')).toBeNull();
  });

  test('a reference is a task id or a handle', () => {
    const harness = createHarness();
    const projectId = writeProject(harness, 'Superwall', 'SW');
    const taskId = create(harness, { projectId });
    expect(selectTaskByReference(harness.state, taskId)?.id).toBe(taskId);
    expect(selectTaskByReference(harness.state, 'sw-1')?.id).toBe(taskId);
    expect(selectTaskByReference(harness.state, 'nope')).toBeNull();
  });

  test('a project’s repositories are the ones filed into it', () => {
    const harness = createHarness();
    const repoId = registerRepo(harness);
    registerRepo(harness, 'scratch', null);
    const projectId = harness.state.repos[repoId]?.projectId ?? '';
    expect(listProjectRepos(harness.state, projectId).map((repo) => repo.id)).toEqual([repoId]);
    expect(listProjectRepos(harness.state, 'gone')).toEqual([]);
  });
});
