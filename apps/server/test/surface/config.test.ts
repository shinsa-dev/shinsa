import { describe, expect, setSystemTime, test } from 'bun:test';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { HOUR_MS, PROJECT_COLORS } from '@shinsa/core';
import { createTempDir } from '../helpers/index.ts';
import { createFakeClient, runSpec } from './fixtures.ts';

const PROJECTS = {
  projects: [
    {
      id: 'project-1',
      name: 'Work',
      color: 'blue',
      key: 'WK',
      description: 'The day job.',
      folders: ['/code/work'],
      repos: [{ id: 'repo-1', name: 'app', path: '/code/app' }],
    },
    {
      id: 'project-2',
      name: 'Home',
      color: 'green',
      key: 'HOME',
      description: '',
      folders: [],
      repos: [],
    },
  ],
  focus: { projectId: null, until: null },
};

const REPOS = { repos: [{ id: 'repo-1', name: 'app', path: '/code/app', defaultBranch: 'main' }] };

function onboarding(configured: string[]) {
  return {
    completed: true,
    roots: { source: 'chosen', configured, effective: configured },
    paths: { dataDir: '/data', configPath: '/config.json' },
  };
}

describe('settings', () => {
  test('shows every setting or one, and says when one uses its default', async () => {
    const fake = createFakeClient({
      '/api/settings': { settings: { maxFixRounds: 3, mergeMethod: 'squash' } },
    });
    expect((await runSpec(fake, ['settings', 'get'])).text).toBe('maxFixRounds = 3\nmergeMethod = "squash"');
    expect((await runSpec(fake, ['settings', 'get', 'mergeMethod'])).text).toBe('mergeMethod = "squash"');
    expect((await runSpec(fake, ['settings', 'get', 'fastMode'])).text).toBe(
      'fastMode is not set; it uses its default.'
    );
  });

  test('a value is read as JSON when it is JSON and as text otherwise', async () => {
    const fake = createFakeClient();
    expect((await runSpec(fake, ['settings', 'set', 'maxFixRounds', '4'])).text).toBe('Set maxFixRounds.');
    await runSpec(fake, ['settings', 'set', 'agentModels', '{"agent":"opus"}']);
    await runSpec(fake, ['settings', 'set', 'mergeMethod', 'squash']);
    expect(fake.sent).toEqual([
      { type: 'settings.change', patch: { maxFixRounds: 4 } },
      { type: 'settings.change', patch: { agentModels: { agent: 'opus' } } },
      { type: 'settings.change', patch: { mergeMethod: 'squash' } },
    ]);
  });

  test('an unknown setting is refused and the settings are named', async () => {
    const fake = createFakeClient();
    await expect(runSpec(fake, ['settings', 'set', 'colour', 'red'])).rejects.toThrow(
      /^No setting colour\. The settings are defaultProvider, /
    );
    expect(fake.sent).toEqual([]);
  });
});

describe('projects and focus', () => {
  test('lists the projects with their keys and repositories, or says there are none', async () => {
    const fake = createFakeClient({ '/api/projects': PROJECTS });
    expect((await runSpec(fake, ['projects', 'list'])).text).toBe(
      'WK     Work  (1 repository)  project-1\nHOME   Home  (0 repositories)  project-2'
    );
    const empty = createFakeClient({ '/api/projects': { projects: [], focus: PROJECTS.focus } });
    expect((await runSpec(empty, ['projects', 'list'])).text).toBe('No projects.');
  });

  test('shows a project found by key, name or id, with its repositories and folders', async () => {
    const fake = createFakeClient({
      '/api/projects': { ...PROJECTS, focus: { projectId: 'project-1', until: null } },
    });
    const work = [
      'Work (WK), in focus',
      'The day job.',
      '',
      'Repositories:',
      '  app  /code/app',
      '',
      'Folders:',
      '  /code/work',
    ].join('\n');
    expect((await runSpec(fake, ['projects', 'show', 'wk'])).text).toBe(work);
    expect((await runSpec(fake, ['projects', 'show', 'WORK'])).text).toBe(work);
    expect((await runSpec(fake, ['projects', 'show', 'project-2'])).text).toBe(
      'Home (HOME)\nNo description.\n\nNo repositories yet.'
    );
    expect((await runSpec(fake, ['projects', 'show', 'Garden'])).text).toBe(
      'No project Garden. `shinsa projects list` lists them.'
    );
  });

  test('writes a new project with the next free colour, or changes one and keeps what was not given', async () => {
    const fake = createFakeClient({ '/api/projects': PROJECTS });
    const basket = createTempDir();
    expect(
      (
        await runSpec(fake, [
          'projects',
          'write',
          '--name',
          'Basket',
          '--description',
          'The grocery app.',
          '--folders',
          '~',
          '--folders',
          basket,
        ])
      ).text
    ).toBe('Saved the project.');
    await runSpec(fake, ['projects', 'write', '--name', 'Play', '--key', 'pl', '--color', 'pink']);
    await runSpec(fake, ['projects', 'write', '--id', 'WK', '--name', 'Job']);
    await runSpec(fake, [
      'projects',
      'write',
      '--id',
      'home',
      '--description',
      'Chores.',
      '--folders',
      basket,
    ]);
    expect(fake.sent).toEqual([
      {
        type: 'project.write',
        project: {
          name: 'Basket',
          color: 'purple',
          description: 'The grocery app.',
          folders: [realpathSync(homedir()), realpathSync(basket)],
        },
      },
      { type: 'project.write', project: { name: 'Play', color: 'pink', key: 'pl' } },
      {
        type: 'project.write',
        project: {
          id: 'project-1',
          name: 'Job',
          color: 'blue',
          key: 'WK',
          description: 'The day job.',
          folders: ['/code/work'],
        },
      },
      {
        type: 'project.write',
        project: {
          id: 'project-2',
          name: 'Home',
          color: 'green',
          key: 'HOME',
          description: 'Chores.',
          folders: [realpathSync(basket)],
        },
      },
    ]);
  });

  test('a new project needs a name, and a project to change must exist', async () => {
    const fake = createFakeClient({ '/api/projects': PROJECTS });
    await expect(runSpec(fake, ['projects', 'write', '--key', 'NEW'])).rejects.toThrow(
      'Name the new project with --name.'
    );
    await expect(runSpec(fake, ['projects', 'write', '--id', 'Garden', '--name', 'G'])).rejects.toThrow(
      'No project Garden. `shinsa projects list` lists them.'
    );
    expect(fake.sent).toEqual([]);
  });

  test('a new project takes the first colour when every one is used', async () => {
    const used = PROJECT_COLORS.map((color, index) => ({ ...PROJECTS.projects[1], id: `p-${index}`, color }));
    const fake = createFakeClient({ '/api/projects': { projects: used, focus: PROJECTS.focus } });
    await runSpec(fake, ['projects', 'write', '--name', 'More']);
    expect(fake.sent).toEqual([
      { type: 'project.write', project: { name: 'More', color: PROJECT_COLORS[0] } },
    ]);
  });

  test('removes a project found by name', async () => {
    const fake = createFakeClient({ '/api/projects': PROJECTS });
    expect((await runSpec(fake, ['projects', 'remove', 'home'])).text).toBe('Removed the project.');
    expect(fake.sent).toEqual([{ type: 'project.remove', projectId: 'project-2' }]);
    await expect(runSpec(fake, ['projects', 'remove', 'Garden'])).rejects.toThrow(
      'No project Garden. `shinsa projects list` lists them.'
    );
  });

  test('adds a repository or a folder to a project through its routes', async () => {
    const fake = createFakeClient({
      '/api/projects': PROJECTS,
      '/api/projects/project-1/repos': { repo: { id: 'repo-2' } },
      '/api/projects/project-1/folders': { project: { id: 'project-1' } },
    });
    expect((await runSpec(fake, ['projects', 'add-repo', 'WK', '~/code/server'])).text).toBe(
      'Added the repository to Work.'
    );
    expect((await runSpec(fake, ['projects', 'add-folder', 'Work', 'work'])).text).toBe(
      'Added the folder to Work.'
    );
    expect(fake.posts).toEqual([
      { path: '/api/projects/project-1/repos', body: { path: '~/code/server' } },
      { path: '/api/projects/project-1/folders', body: { path: resolve('work') } },
    ]);
  });

  test('a project folder must be a folder on this machine', async () => {
    const fake = createFakeClient({ '/api/projects': PROJECTS });
    await expect(
      runSpec(fake, ['projects', 'write', '--name', 'Basket', '--folders', '~/no-such-folder-here'])
    ).rejects.toThrow('~/no-such-folder-here is not a folder on this machine.');
    expect(fake.sent).toEqual([]);
  });

  test('an agent adds a repository or a folder in process, not over HTTP', async () => {
    const fake = createFakeClient({ '/api/projects': PROJECTS });
    const changed: string[] = [];
    fake.client.projects = {
      upsertRepo: (projectId, path) => Promise.resolve(changed.push(`repo ${projectId} ${path}`)),
      upsertFolder: (projectId, path) => Promise.resolve(changed.push(`folder ${projectId} ${path}`)),
    };
    await runSpec(fake, ['projects', 'add-repo', 'WK', '~/code/server']);
    await runSpec(fake, ['projects', 'add-folder', 'Work', '/code/basket']);
    expect(changed).toEqual(['repo project-1 ~/code/server', 'folder project-1 /code/basket']);
    expect(fake.posts).toEqual([]);
  });

  test('shows the focus with its end, or that everything shows', async () => {
    const until = Date.UTC(2026, 9, 23, 18);
    const fake = createFakeClient({
      '/api/projects': (_path: string) => PROJECTS,
    });
    expect((await runSpec(fake, ['focus', 'show'])).text).toBe('No focus: everything shows.');
    const focused = createFakeClient({
      '/api/projects': { ...PROJECTS, focus: { projectId: 'project-1', until } },
    });
    expect((await runSpec(focused, ['focus', 'show'])).text).toBe(
      'Focused on Work until 2026-10-23T18:00:00.000Z.'
    );
    const open = createFakeClient({
      '/api/projects': { ...PROJECTS, focus: { projectId: 'project-2', until: null } },
    });
    expect((await runSpec(open, ['focus', 'show'])).text).toBe('Focused on Home.');
  });

  test('focuses on a project for a while or until cleared', async () => {
    setSystemTime(new Date(1_000));
    try {
      const fake = createFakeClient({ '/api/projects': PROJECTS });
      expect((await runSpec(fake, ['focus', 'set', 'Work', '--hours', '1.5'])).text).toBe('Focused.');
      await runSpec(fake, ['focus', 'set', 'project-2']);
      expect((await runSpec(fake, ['focus', 'clear'])).text).toBe('Everything shows again.');
      expect(fake.sent).toEqual([
        { type: 'focus.change', projectId: 'project-1', until: 1_000 + 1.5 * HOUR_MS },
        { type: 'focus.change', projectId: 'project-2', until: null },
        { type: 'focus.change', projectId: null, until: null },
      ]);
    } finally {
      setSystemTime();
    }
  });
});

describe('repositories', () => {
  test('lists the repositories, or says Shinsa has none yet', async () => {
    const fake = createFakeClient({ '/api/repos': REPOS });
    expect((await runSpec(fake, ['repos', 'list'])).text).toBe('repo-1  app  /code/app  (main)');
    const empty = createFakeClient({ '/api/repos': { repos: [] } });
    expect((await runSpec(empty, ['repos', 'list'])).text).toBe(
      'No repositories yet. Shinsa registers one the first time it works there.'
    );
  });

  test('an update sends only what was given, and none clears the project', async () => {
    const fake = createFakeClient({ '/api/repos': REPOS, '/api/projects': PROJECTS });
    expect(
      (
        await runSpec(fake, [
          'repos',
          'update',
          'app',
          '--name',
          'web',
          '--default-branch',
          'trunk',
          '--project',
          'Work',
          '--checks',
          'bun test',
          '--checks',
          'bun lint',
          '--waive-checks',
          '--workspace',
          'gitbutler',
        ])
      ).text
    ).toBe('Saved the repository.');
    await runSpec(fake, ['repos', 'update', 'repo-1', '--project', 'none', '--no-waive-checks']);
    await runSpec(fake, ['repos', 'update', 'app']);
    expect(fake.sent).toEqual([
      {
        type: 'repo.update',
        repoId: 'repo-1',
        patch: {
          name: 'web',
          defaultBranch: 'trunk',
          projectId: 'project-1',
          checkCommands: ['bun test', 'bun lint'],
          checksWaived: true,
          workspace: 'gitbutler',
        },
      },
      {
        type: 'repo.update',
        repoId: 'repo-1',
        patch: { projectId: null, checksWaived: false },
      },
      { type: 'repo.update', repoId: 'repo-1', patch: {} },
    ]);
  });

  test('removing forgets the repository', async () => {
    const fake = createFakeClient({ '/api/repos': REPOS });
    expect((await runSpec(fake, ['repos', 'remove', 'app'])).text).toBe('Removed the repository.');
    expect(fake.sent).toEqual([{ type: 'repo.remove', repoId: 'repo-1' }]);
  });
});

describe('folders', () => {
  test('lists the folders Shinsa looks in', async () => {
    const fake = createFakeClient({ '/api/onboarding': onboarding(['~/code', '/work']) });
    expect((await runSpec(fake, ['folders', 'list'])).text).toBe(
      'Folders Shinsa looks in (chosen):\n  ~/code\n  /work'
    );
  });

  test('suggests folders with repositories, rescanning when asked', async () => {
    const suggestions = {
      suggestions: [
        { path: '/code', repoCount: 4, chosen: true },
        { path: '/other', repoCount: 1, chosen: false },
      ],
    };
    const fake = createFakeClient({
      '/api/onboarding/roots': suggestions,
      '/api/onboarding/roots?refresh=1': { suggestions: [] },
    });
    expect((await runSpec(fake, ['folders', 'suggest'])).text).toBe(
      '* /code  (4 repositories)\n  /other  (1 repositories)'
    );
    expect((await runSpec(fake, ['folders', 'suggest', '--refresh'])).text).toBe(
      'No folders with repositories found.'
    );
  });

  test('adds a folder by its full path, keeps ~/ as given, and removes one', async () => {
    let roots = ['/work'];
    const fake = createFakeClient({
      '/api/onboarding': () => onboarding(roots),
      '/api/onboarding/setup': (_path: string, body: unknown) => {
        roots = (body as { roots: string[] }).roots;
        return onboarding(roots);
      },
    });
    await runSpec(fake, ['folders', 'add', 'projects']);
    const result = await runSpec(fake, ['folders', 'add', '~/code']);
    expect(roots).toEqual(['/work', resolve('projects'), '~/code']);
    expect(result.text).toBe(
      `Folders Shinsa looks in (chosen):\n  /work\n  ${resolve('projects')}\n  ~/code`
    );
    await runSpec(fake, ['folders', 'remove', '/work']);
    expect(roots).toEqual([resolve('projects'), '~/code']);
  });
});
