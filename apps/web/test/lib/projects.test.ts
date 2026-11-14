import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { PROJECT_COLORS } from '@shinsa/core';
import {
  createProjectDraft,
  describeProjectKey,
  describeProjectUsageLimit,
  describeProjectRemoval,
  listLooseRepos,
  listProjectRepoRows,
  listProjects,
  listRepoChoiceGroups,
  PROJECT_ACTIONS,
  resolveDraftInput,
  resolveProjectInk,
  resolveProjectInput,
  resolveRepoIcon,
  resolveRepoKey,
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
    expect(listLooseRepos({ ...state, teammateRepos: { loose: true } }).map((repo) => repo.id)).toEqual([
      'orphan',
    ]);
  });

  it('selects a project by id and a task’s project through its repository', () => {
    const state = stateWith();
    expect(selectProject(state, 'p1')?.name).toBe('Superwall');
    expect(selectProject(state, null)).toBeNull();
    expect(selectProject(state, 'gone')).toBeNull();
    expect(selectTaskProject(state, createTask({ id: 't', repoId: 'web' }))?.name).toBe('Superwall');
    expect(selectTaskProject(state, createTask({ id: 't', projectId: 'p2' }))?.name).toBe('Basket');
  });

  it('inks a project in its colour, grey for none, and marks a repository by where it lives', () => {
    expect(resolveProjectInk('purple')).toBe('var(--purple-4, var(--fg-2))');
    expect(resolveProjectInk('gray')).toBe('var(--fg-2)');
    expect(resolveRepoIcon(createRepo({ id: 'web', remote: 'git@github.com:you/web.git' }))).toBe(
      'IconGithub'
    );
    expect(resolveRepoIcon(createRepo({ id: 'local', remote: null }))).toBe('IconFolder1');
  });

  it('explains the key by the handles it makes', () => {
    expect(describeProjectKey('SW')).toBe('Tasks in this project are named SW-1, SW-2…');
  });
});

describe('repository keys', () => {
  it('keys the repositories so what they report is read again only when they change', () => {
    expect(resolveRepoKey([createRepo({ id: 'b' }), createRepo({ id: 'a' })])).toBe('a,b');
  });
});

describe('the project dialog', () => {
  it('starts from the project, or empty for a new one', () => {
    expect(createProjectDraft(SUPERWALL)).toEqual({
      name: 'Superwall',
      key: 'SW',
      description: 'Paywalls',
      usageLimit: '',
    });
    expect(createProjectDraft(null)).toEqual({ name: '', key: '', description: '', usageLimit: '' });
  });

  it('checks the name, the key and the description it edits', () => {
    const state = stateWith();
    const long = 'x'.repeat(1001);
    expect(
      validateProjectDraft(state, 'create', { name: ' ', key: '', description: '', usageLimit: '' }, null)
    ).toEqual({
      ok: false,
      errors: { name: 'Give the project a name.' },
    });
    expect(
      validateProjectDraft(
        state,
        'create',
        { name: 'x'.repeat(200), key: '1A', description: long, usageLimit: '' },
        null
      ).errors
    ).toEqual({
      name: 'Use 80 characters or fewer.',
      key: 'Use 2 to 6 letters or digits, starting with a letter.',
      description: 'Use 1,000 characters or fewer.',
    });
    expect(
      validateProjectDraft(state, 'key', { name: '', key: ' ', description: '', usageLimit: '' }, 'p1').errors
    ).toEqual({
      key: 'Type a key, like SW.',
    });
    expect(
      validateProjectDraft(state, 'key', { name: '', key: 'bas', description: '', usageLimit: '' }, 'p1')
        .errors
    ).toEqual({
      key: 'Basket already uses BAS.',
    });
    expect(
      validateProjectDraft(state, 'key', { name: '', key: 'sw', description: '', usageLimit: '' }, 'p1').ok
    ).toBe(true);
    expect(
      validateProjectDraft(
        state,
        'name',
        { name: 'Paywalls', key: '1', description: long, usageLimit: '' },
        'p1'
      ).ok
    ).toBe(true);
  });

  it('turns the draft into the project to write, upper-casing the key and keeping what it does not edit', () => {
    const state = stateWith();
    expect(
      resolveDraftInput(
        state,
        { name: ' Superwall 2 ', key: '', description: ' d ', usageLimit: '' },
        SUPERWALL
      )
    ).toEqual({
      ...resolveProjectInput(SUPERWALL),
      name: 'Superwall 2',
      description: 'd',
      key: 'SW',
    });
    expect(
      resolveDraftInput(state, { name: 'Home', key: 'hm', description: '', usageLimit: '' }, null)
    ).toEqual({
      name: 'Home',
      description: '',
      color: 'blue',
      key: 'HM',
    });
    expect(
      resolveDraftInput(state, { name: 'Home', key: '', description: '', usageLimit: '' }, null)
    ).not.toHaveProperty('key');
  });

  it('checks and writes the usage limit, empty for none', () => {
    const state = stateWith();
    const draft = { name: 'Home', key: '', description: '', usageLimit: '20%' };
    expect(validateProjectDraft(state, 'usageLimit', draft, 'p1').ok).toBe(true);
    expect(validateProjectDraft(state, 'usageLimit', { ...draft, usageLimit: '0' }, 'p1').errors).toEqual({
      usageLimit: 'Type a percentage above zero, like 20.',
    });
    expect(validateProjectDraft(state, 'usageLimit', { ...draft, usageLimit: 'lots' }, 'p1').ok).toBe(false);
    expect(validateProjectDraft(state, 'name', { ...draft, usageLimit: 'lots' }, 'p1').ok).toBe(true);
    expect(resolveDraftInput(state, draft, null).usageLimit).toBe(20);
    expect(resolveDraftInput(state, { ...draft, usageLimit: ' ' }, SUPERWALL)).not.toHaveProperty(
      'usageLimit'
    );
    const limited = { ...SUPERWALL, usageLimit: 12.5 };
    expect(resolveDraftInput(state, { ...draft, usageLimit: '' }, limited).usageLimit).toBeNull();
    expect(resolveDraftInput(state, { ...draft, usageLimit: '12.5' }, limited)).not.toHaveProperty(
      'usageLimit'
    );
    expect(createProjectDraft(limited).usageLimit).toBe('12.5');
    expect(describeProjectUsageLimit(limited)).toBe('12.5% a day');
    expect(describeProjectUsageLimit(SUPERWALL)).toBeNull();
  });

  it('gives a new project the first colour no project has, and blue once all are taken', () => {
    const draft = { name: 'Home', key: '', description: '', usageLimit: '' };
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
      done: 'Project removed.',
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
      'Folder added.',
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
