import { describe, expect, it } from 'bun:test';
import { isSameTaskRowModel, resolveTaskRowModel } from '@/lib/tasks/row-model.ts';
import { createGate, createProject, createRepo, createShinsaState, createTask } from '../../support/state.ts';

const STATE = createShinsaState({
  projects: [createProject({ id: 'core', name: 'Core' })],
  repos: [createRepo({ id: 'web', projectId: 'core' }), createRepo({ id: 'loose' })],
  tasks: [
    createTask({ id: 'base', title: 'Build the search index', stage: 'building', repoId: 'web' }),
    createTask({ id: 'lint', title: 'Fix the lint', stage: 'building', repoId: 'loose' }),
    createTask({ id: 'docs', title: 'Ship search docs', stage: 'waiting_on_tasks', waitsOn: ['base'] }),
    createTask({
      id: 'stack',
      title: 'Stack on the index',
      stage: 'waiting_on_tasks',
      waitsOn: ['base', 'lint'],
      stacksOn: ['base'],
    }),
    createTask({ id: 'merge', title: 'Land the billing change', stage: 'awaiting_merge' }),
  ],
  gates: [createGate({ id: 'g-merge', taskId: 'merge', type: 'merge' })],
});

function findTask(id: string) {
  const found = STATE.tasks[id];
  if (!found) throw new Error(`No task ${id}`);
  return found;
}

describe('resolveTaskRowModel', () => {
  it('holds the repository and its project, or none', () => {
    const inProject = resolveTaskRowModel(STATE, findTask('base'));
    expect(inProject.repo?.id).toBe('web');
    expect(inProject.project?.name).toBe('Core');
    const loose = resolveTaskRowModel(STATE, findTask('lint'));
    expect(loose.repo?.id).toBe('loose');
    expect(loose.project).toBeNull();
    expect(resolveTaskRowModel(STATE, findTask('merge')).repo).toBeNull();
  });

  it('holds the status the row shows', () => {
    expect(resolveTaskRowModel(STATE, findTask('merge')).status.tone).not.toBe('neutral');
  });

  it('lists what a held task waits on, and whether it is stacked on all of it', () => {
    const docs = resolveTaskRowModel(STATE, findTask('docs'));
    expect(docs.waitsOn.map((task) => task.id)).toEqual(['base']);
    expect(docs.stacked).toBe(false);
    expect(resolveTaskRowModel(STATE, findTask('base')).waitsOn).toEqual([]);
  });

  it('splits the chain into stack parents and other waits only below the top', () => {
    const top = resolveTaskRowModel(STATE, findTask('stack'));
    expect(top.stackParents).toEqual([]);
    expect(top.chainOthers).toEqual([]);
    const nested = resolveTaskRowModel(STATE, findTask('stack'), 1);
    expect(nested.depth).toBe(1);
    expect(nested.stackParents.map((task) => task.id)).toEqual(['base']);
    expect(nested.chainOthers.map((task) => task.id)).toEqual(['lint']);
  });
});

describe('isSameTaskRowModel', () => {
  it('keeps a row a push did not touch, and redraws one whose chain parent changed', () => {
    const pushed = { ...STATE, tasks: { ...STATE.tasks, lint: { ...findTask('lint'), title: 'Fix it' } } };
    expect(
      isSameTaskRowModel(
        resolveTaskRowModel(STATE, findTask('stack'), 1),
        resolveTaskRowModel(pushed, findTask('stack'), 1)
      )
    ).toBe(false);
    expect(
      isSameTaskRowModel(
        resolveTaskRowModel(STATE, findTask('docs')),
        resolveTaskRowModel(pushed, findTask('docs'))
      )
    ).toBe(true);
  });

  it('redraws a row when its task, depth, status or waits change', () => {
    const base = resolveTaskRowModel(STATE, findTask('docs'));
    expect(isSameTaskRowModel(base, { ...base, task: { ...base.task } })).toBe(false);
    expect(isSameTaskRowModel(base, { ...base, depth: 1 })).toBe(false);
    expect(isSameTaskRowModel(base, { ...base, status: { ...base.status, label: 'Other' } })).toBe(false);
    expect(isSameTaskRowModel(base, { ...base, status: { ...base.status, tone: 'red' } })).toBe(false);
    expect(isSameTaskRowModel(base, { ...base, stacked: true })).toBe(false);
    expect(isSameTaskRowModel(base, { ...base, waitsOn: [] })).toBe(false);
    expect(isSameTaskRowModel(base, { ...base, waitsOn: [findTask('lint')] })).toBe(false);
    expect(isSameTaskRowModel(base, { ...base, repo: STATE.repos.web ?? null })).toBe(false);
    expect(isSameTaskRowModel(base, { ...base, project: STATE.projects.core ?? null })).toBe(false);
  });
});
