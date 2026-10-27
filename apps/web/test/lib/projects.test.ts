import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { PROJECT_COLORS } from '@shinsa/core';
import {
  createProjectDraft,
  describeProjectKey,
  describeProjectRemoval,
  listLooseRepos,
  listProjectRepoRows,
  listProjects,
  listRepoChoiceGroups,
  PROJECT_ACTIONS,
  resolveDraftInput,
  resolveProjectInput,
  resolveRepoProjectLabel,
  resolveTaskProjectLabel,
  selectProject,
  selectTaskProject,
  validateFolderPath,
  validateProjectDraft,
} from '@/lib/projects.ts';
import { spyOnToasts } from '../support/commands.ts';
import { startFakeOnboarding } from '../support/onboarding.ts';
import {
  holdAcks,
  listSentCommands,
  releaseAcks,
  startFakeServer,
  stopFakeServer,
} from '../support/server.ts';
import { createProject, createRepo, createShinsaState, createTask } from '../support/state.ts';

const SUPERWALL = createProject({
  id: 'p1',
  name: 'Superwall',
  key: 'SW',
  color: 'purple',
  description: 'Paywalls',
  folders: ['/Users/you/Developer/Superwall'],
});

const BASKET = createProject({ id: 'p2', name: 'Basket', key: 'BAS', color: 'green' });

function stateWith() {
  return createShinsaState({
    projects: [SUPERWALL, BASKET],
    repos: [
      createRepo({ id: 'web', projectId: 'p1' }),
      createRepo({ id: 'api', projectId: 'p1' }),
      createRepo({ id: 'loose' }),
      createRepo({ id: 'orphan', projectId: 'gone' }),
    ],
  });
}

describe('reading projects', () => {
  it('lists projects and their repositories by name, and the repositories with no project', () => {
    const state = stateWith();
    expect(listProjects(state).map((project) => project.name)).toEqual(['Basket', 'Superwall']);
    expect(listProjectRepoRows(state, 'p1').map((repo) => repo.id)).toEqual(['api', 'web']);
    expect(listLooseRepos(state).map((repo) => repo.id)).toEqual(['loose', 'orphan']);
  });

  it('selects a project by id and a task’s project through its repository', () => {
    const state = stateWith();
    expect(selectProject(state, 'p1')?.name).toBe('Superwall');
    expect(selectProject(state, null)).toBeNull();
    expect(selectProject(state, 'gone')).toBeNull();
    expect(selectTaskProject(state, createTask({ id: 't', repoId: 'web' }))?.name).toBe('Superwall');
    expect(selectTaskProject(state, createTask({ id: 't', projectId: 'p2' }))?.name).toBe('Basket');
  });

  it('labels a project by its dot and name, and names the repository only when the project has several', () => {
    const state = createShinsaState({
      projects: [SUPERWALL, BASKET],
      repos: [
        createRepo({ id: 'web', name: 'web', projectId: 'p1' }),
        createRepo({ id: 'api', name: 'api', projectId: 'p1' }),
        createRepo({ id: 'basket', name: 'basket-ios', projectId: 'p2' }),
        createRepo({ id: 'loose', name: 'scratch' }),
      ],
    });
    const repo = (id: string) => createRepo({ ...state.repos[id], id });
    expect(resolveRepoProjectLabel(state, repo('web'))).toEqual({
      color: 'purple',
      name: 'Superwall',
      repo: 'web',
    });
    expect(resolveRepoProjectLabel(state, repo('basket'))).toEqual({
      color: 'green',
      name: 'Basket',
      repo: null,
    });
    expect(resolveRepoProjectLabel(state, repo('loose'))).toEqual({
      color: 'gray',
      name: 'scratch',
      repo: null,
    });
    expect(resolveTaskProjectLabel(state, createTask({ id: 't', repoId: 'api' }))).toEqual({
      color: 'purple',
      name: 'Superwall',
      repo: 'api',
    });
    expect(resolveTaskProjectLabel(state, createTask({ id: 't', projectId: 'p1' }))?.repo).toBeNull();
    expect(resolveTaskProjectLabel(state, createTask({ id: 't', projectId: 'p2', repoId: 'web' }))).toEqual({
      color: 'green',
      name: 'Basket',
      repo: null,
    });
    expect(resolveTaskProjectLabel(state, createTask({ id: 't', repoId: 'loose' }))?.name).toBe('scratch');
    expect(resolveTaskProjectLabel(state, createTask({ id: 't' }))).toBeNull();
  });

  it('explains the key by the handles it makes', () => {
    expect(describeProjectKey('SW')).toBe('Tasks in this project are named SW-1, SW-2…');
  });
});

describe('the project dialog', () => {
  it('starts from the project, or empty for a new one', () => {
    expect(createProjectDraft(SUPERWALL)).toEqual({ name: 'Superwall', key: 'SW', description: 'Paywalls' });
    expect(createProjectDraft(null)).toEqual({ name: '', key: '', description: '' });
  });

  it('checks the name, the key and the description it edits', () => {
    const state = stateWith();
    const long = 'x'.repeat(1001);
    expect(validateProjectDraft(state, 'create', { name: ' ', key: '', description: '' }, null)).toEqual({
      ok: false,
      errors: { name: 'Give the project a name.' },
    });
    expect(
      validateProjectDraft(state, 'create', { name: 'x'.repeat(200), key: '1A', description: long }, null)
        .errors
    ).toEqual({
      name: 'Use 80 characters or fewer.',
      key: 'Use 2 to 6 letters or digits, starting with a letter.',
      description: 'Use 1,000 characters or fewer.',
    });
    expect(validateProjectDraft(state, 'key', { name: '', key: ' ', description: '' }, 'p1').errors).toEqual({
      key: 'Type a key, like SW.',
    });
    expect(
      validateProjectDraft(state, 'key', { name: '', key: 'bas', description: '' }, 'p1').errors
    ).toEqual({
      key: 'Basket already uses BAS.',
    });
    expect(validateProjectDraft(state, 'key', { name: '', key: 'sw', description: '' }, 'p1').ok).toBe(true);
    expect(
      validateProjectDraft(state, 'name', { name: 'Paywalls', key: '1', description: long }, 'p1').ok
    ).toBe(true);
  });

  it('turns the draft into the project to write, upper-casing the key and keeping what it does not edit', () => {
    const state = stateWith();
    expect(
      resolveDraftInput(state, { name: ' Superwall 2 ', key: '', description: ' d ' }, SUPERWALL)
    ).toEqual({
      ...resolveProjectInput(SUPERWALL),
      name: 'Superwall 2',
      description: 'd',
      key: 'SW',
    });
    expect(resolveDraftInput(state, { name: 'Home', key: 'hm', description: '' }, null)).toEqual({
      name: 'Home',
      description: '',
      color: 'blue',
      key: 'HM',
    });
    expect(resolveDraftInput(state, { name: 'Home', key: '', description: '' }, null)).not.toHaveProperty(
      'key'
    );
  });

  it('gives a new project the first colour no project has, and blue once all are taken', () => {
    const draft = { name: 'Home', key: '', description: '' };
    const used = createShinsaState({ projects: [createProject({ id: 'a', color: 'blue' })] });
    expect(resolveDraftInput(used, draft, null).color).toBe(PROJECT_COLORS[1]);
    const full = createShinsaState({
      projects: PROJECT_COLORS.map((color, index) => createProject({ id: `p${index}`, color })),
    });
    expect(resolveDraftInput(full, draft, null).color).toBe('blue');
  });
});

describe('folders and repositories to add', () => {
  it('asks for a full path', () => {
    expect(validateFolderPath(' ')).toBe('Type the folder’s path.');
    expect(validateFolderPath('Developer')).toBe('Use the full path, starting with / or ~/.');
    expect(validateFolderPath('~/Developer')).toBeNull();
    expect(validateFolderPath('/Users/you')).toBeNull();
  });

  it('offers repositories outside the project: free ones first, then other projects’ with their name', () => {
    const groups = listRepoChoiceGroups(
      stateWith(),
      [
        { path: '/r/web', name: 'web', repoId: 'web', projectId: 'p1' },
        { path: '/r/zed', name: 'zed', repoId: null, projectId: null },
        { path: '/r/app', name: 'app', repoId: null, projectId: 'gone' },
        { path: '/r/ios', name: 'ios', repoId: 'ios', projectId: 'p2' },
      ],
      'p1'
    );
    expect(groups).toEqual([
      {
        title: 'In your folders',
        repos: [
          { path: '/r/app', name: 'app', detail: '/r/app' },
          { path: '/r/zed', name: 'zed', detail: '/r/zed' },
        ],
      },
      { title: 'In other projects', repos: [{ path: '/r/ios', name: 'ios', detail: 'Basket' }] },
    ]);
    expect(listRepoChoiceGroups(stateWith(), [], 'p1')).toEqual([]);
  });

  it('says what removing a project does to its repositories', () => {
    expect(describeProjectRemoval(SUPERWALL, 2)).toEqual({
      title: 'Remove Superwall?',
      body: 'Its 2 repositories stay registered, without a project. Tasks keep their handles.',
      done: 'Project removed. Its repositories have no project now.',
    });
    expect(describeProjectRemoval(BASKET, 0)).toEqual({
      title: 'Remove Basket?',
      body: 'Tasks keep their handles. Nothing on disk changes.',
      done: 'Project removed.',
    });
  });
});

describe('PROJECT_ACTIONS', () => {
  let toasts: ReturnType<typeof spyOnToasts>;
  let fake: ReturnType<typeof startFakeOnboarding> | null = null;

  beforeEach(() => {
    toasts = spyOnToasts();
    startFakeServer();
  });

  afterEach(() => {
    toasts.restore();
    fake?.stop();
    fake = null;
    stopFakeServer();
  });

  it('writes, saves, removes and takes a repository or a folder out, as commands', async () => {
    const repo = createRepo({ id: 'web', projectId: 'p1' });
    expect(
      await PROJECT_ACTIONS.write(resolveProjectInput(BASKET, { color: 'red' }), 'Colour changed.')
    ).toBe(true);
    expect(
      await PROJECT_ACTIONS.save(resolveProjectInput(SUPERWALL, { key: 'SUP' }), 'Key changed.')
    ).toBeNull();
    expect(await PROJECT_ACTIONS.remove(BASKET, 'Project removed.')).toBe(true);
    expect(await PROJECT_ACTIONS.removeRepo(repo)).toBe(true);
    expect(await PROJECT_ACTIONS.removeFolder(SUPERWALL, '/Users/you/Developer/Superwall')).toBe(true);
    expect(listSentCommands()).toEqual([
      { type: 'project.write', project: resolveProjectInput(BASKET, { color: 'red' }) },
      { type: 'project.write', project: resolveProjectInput(SUPERWALL, { key: 'SUP' }) },
      { type: 'project.remove', projectId: 'p2' },
      { type: 'repo.update', repoId: 'web', patch: { projectId: null } },
      { type: 'project.write', project: resolveProjectInput(SUPERWALL, { folders: [] }) },
    ]);
    expect(toasts.success.mock.calls.map((call) => call[0])).toEqual([
      'Colour changed.',
      'Key changed.',
      'Project removed.',
      'Repository removed from the project.',
      'Folder removed.',
    ]);
  });

  it('hands back the server’s refusal of a save instead of a toast', async () => {
    holdAcks();
    const saved = PROJECT_ACTIONS.save(resolveProjectInput(SUPERWALL, { key: 'BAS' }), 'Key changed.');
    await Promise.resolve();
    releaseAcks({ code: 'project_key_taken', message: 'Basket already uses BAS.' });
    expect(await saved).toBe('Basket already uses BAS.');
    expect(toasts.success).not.toHaveBeenCalled();
    expect(toasts.error).not.toHaveBeenCalled();
  });

  it('lists local repositories and adds a repository or a folder over HTTP', async () => {
    const local = [{ path: '/r/zed', name: 'zed', repoId: null, projectId: null }];
    fake = startFakeOnboarding({
      'GET /api/repos/local': { answer: { repos: local } },
      'POST /api/projects/p1/repos': { answer: { repo: createRepo({ id: 'zed', projectId: 'p1' }) } },
      'POST /api/projects/p1/folders': { answer: { project: SUPERWALL } },
    });
    expect(await PROJECT_ACTIONS.listLocalRepos()).toEqual(local);
    expect(await PROJECT_ACTIONS.addRepo(SUPERWALL, '/r/zed')).toBe(true);
    expect(await PROJECT_ACTIONS.addFolder(SUPERWALL, ' ~/Developer/Superwall ')).toBeNull();
    expect(fake.requests.map((request) => [request.method, request.path, request.body])).toEqual([
      ['GET', '/api/repos/local', null],
      ['POST', '/api/projects/p1/repos', { path: '/r/zed' }],
      ['POST', '/api/projects/p1/folders', { path: '~/Developer/Superwall' }],
    ]);
    expect(toasts.success.mock.calls.map((call) => call[0])).toEqual([
      'Repository added to Superwall.',
      'Folder added. Its repositories belong to the project.',
    ]);
  });

  it('hands back why a folder was refused', async () => {
    fake = startFakeOnboarding({
      'POST /api/projects/p1/folders': {
        status: 400,
        answer: { error: { code: 'folder_invalid', message: 'There is no folder at ~/Nope.' } },
      },
    });
    expect(await PROJECT_ACTIONS.addFolder(SUPERWALL, '~/Nope')).toBe('There is no folder at ~/Nope.');
    expect(toasts.success).not.toHaveBeenCalled();
  });
});
