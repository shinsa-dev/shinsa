import { describe, expect, test } from 'bun:test';
import { createState, type ShinsaState, type Task } from '@shinsa/core';
import type { QuickJson } from '../../src/agents/quick/index.ts';
import type { LocalRepo } from '../../src/repos/index.ts';
import { resolveTriage } from '../../src/triage/index.ts';
import { createRepo, createTask } from '../helpers/state.ts';

const LOCAL: LocalRepo[] = [
  { path: '/code/web', name: 'web', touchedAt: 2 },
  { path: '/code/api', name: 'api', touchedAt: 1 },
];

function answer(value: unknown): QuickJson {
  return <T>() => Promise.resolve(value as T);
}

const silent = answer(null);

function stateWith(patch: (state: ShinsaState) => void = () => undefined) {
  const state = createState();
  patch(state);
  return state;
}

function newTask(overrides: Partial<Task> = {}) {
  return createTask({
    id: 'new',
    repoId: null,
    branch: null,
    stage: 'triage',
    intent: 'Fix the login button',
    ...overrides,
  });
}

describe('resolveTriage without the model', () => {
  test('there is nothing to do without a repository', async () => {
    expect(await resolveTriage(stateWith(), newTask(), [], silent)).toBeNull();
  });

  test('a small change goes to the most recent repository on a fix branch', async () => {
    expect(await resolveTriage(stateWith(), newTask(), LOCAL, silent)).toEqual({
      title: 'Fix the login button',
      repoPath: '/code/web',
      size: 'small',
      branch: 'fix/fix-the-login-button',
      dependsOn: [],
    });
  });

  test('a spec request, a long request or a redesign is large and gets a feat branch', async () => {
    for (const overrides of [
      { specFirst: true },
      { intent: 'x'.repeat(501) },
      { intent: 'Redesign the settings\nwith tabs' },
    ]) {
      const triage = await resolveTriage(stateWith(), newTask(overrides), LOCAL, silent);
      expect(triage?.size).toBe('large');
      expect(triage?.branch.startsWith('feat/')).toBe(true);
    }
    expect((await resolveTriage(stateWith(), newTask({ intent: '\n' }), LOCAL, silent))?.title).toBe(
      'Untitled task'
    );
  });

  test('a pinned repository or the directory shinsa do ran in wins', async () => {
    const pinned = stateWith((draft) => {
      draft.repos.r = createRepo({ id: 'r', path: '/code/api', name: 'api' });
    });
    expect((await resolveTriage(pinned, newTask({ repoId: 'r' }), LOCAL, silent))?.repoPath).toBe(
      '/code/api'
    );
    expect(
      (await resolveTriage(stateWith(), newTask({ origin: '/code/api/src' }), LOCAL, silent))?.repoPath
    ).toBe('/code/api');
  });

  test('repositories Shinsa worked in recently come first, including ones outside the roots', async () => {
    const state = stateWith((draft) => {
      draft.repos.r1 = createRepo({ id: 'r1', path: '/code/api', name: 'api' });
      draft.repos.r2 = createRepo({ id: 'r2', path: '/elsewhere/tool', name: 'tool' });
      draft.tasks.t1 = createTask({ id: 't1', repoId: 'r1', updatedAt: 10 });
      draft.tasks.t2 = createTask({ id: 't2', repoId: 'r1', updatedAt: 5 });
      draft.tasks.t3 = createTask({ id: 't3', repoId: null, updatedAt: 20 });
    });
    const prompts: string[] = [];
    const recording: QuickJson = <T>(_system: string, prompt: string) => {
      prompts.push(prompt);
      return Promise.resolve(null as T);
    };
    expect((await resolveTriage(state, newTask(), LOCAL, recording))?.repoPath).toBe('/code/api');
    expect(prompts[0]).toContain('Repositories, most recently worked on first:\n- api\n- web\n- tool');
    expect(prompts[0]).toContain('- t1: Fix the tab scroll (api)');
    expect(prompts[0]).toContain('- t3: Fix the tab scroll (?)');
    expect((await resolveTriage(stateWith(), newTask(), LOCAL, recording)) && prompts[1]).toContain('(none)');
  });
});

describe('resolveTriage with the model', () => {
  const state = stateWith((draft) => {
    draft.repos.r1 = createRepo({ id: 'r1', path: '/code/api', name: 'api' });
    draft.tasks.same = createTask({ id: 'same', repoId: 'r1' });
    draft.tasks.loose = createTask({ id: 'loose', repoId: null });
    draft.tasks.other = createTask({ id: 'other', repoId: 'r9' });
    draft.tasks.done = createTask({ id: 'done', repoId: 'r1', stage: 'merged' });
  });

  test('takes the title, repository, size, branch and dependencies it names', async () => {
    const triage = await resolveTriage(
      state,
      newTask(),
      LOCAL,
      answer({
        title: '  Fix the login button on mobile  ',
        repo: 'api',
        size: 'large',
        branch: 'fix/login-mobile',
        depends_on: ['same', 'loose', 'other', 'done', 'new', 7],
      })
    );
    expect(triage).toMatchObject({
      title: 'Fix the login button on mobile',
      repoPath: '/code/api',
      size: 'large',
      branch: 'fix/login-mobile',
    });
    expect(triage?.dependsOn.map((task) => task.id)).toEqual(['same', 'loose']);
  });

  test('falls back field by field on anything malformed', async () => {
    const triage = await resolveTriage(
      state,
      newTask(),
      LOCAL,
      answer({ title: '   ', repo: 'unknown', size: 'huge', branch: 'Fix Login', depends_on: 'same' })
    );
    expect(triage).toMatchObject({
      title: 'Fix the login button',
      repoPath: '/code/api',
      size: 'small',
      branch: 'fix/fix-the-login-button',
    });
    expect(triage?.dependsOn.map((task) => task.id)).toEqual(['same']);
  });
});
