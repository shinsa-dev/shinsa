import { describe, expect, test } from 'bun:test';
import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import type { OnboardingProjectChoice } from '@shinsa/core';
import { ConfigStore } from '../../src/config/index.ts';
import { Onboarding } from '../../src/onboarding/index.ts';
import { Roots } from '../../src/repos/index.ts';
import { Engine } from '../../src/runtime/index.ts';
import { EventLog } from '../../src/store/index.ts';
import { createTempDir, createTestConfig, git } from '../helpers/index.ts';

async function createRepo(folder: string, name: string, remote: string | null) {
  const path = join(folder, name);
  mkdirSync(path, { recursive: true });
  await git(path, 'init', '-q', '-b', 'main');
  if (remote) await git(path, 'remote', 'add', 'origin', `git@github.com:${remote}.git`);
  return realpathSync(path);
}

async function setup() {
  const root = realpathSync(createTempDir());
  const config = createTestConfig(root, { roots: [] });
  const engine = new Engine(new EventLog(config.databasePath));
  const store = new ConfigStore(config.configPath);
  const acme = join(root, 'Acme');
  const projects = join(root, 'Projects');
  const repos = {
    api: await createRepo(acme, 'api', 'acme/api'),
    web: await createRepo(acme, 'web', 'acme/web'),
    notes: await createRepo(projects, 'notes', 'jane/notes'),
    scratch: await createRepo(projects, 'scratch', null),
  };
  const roots = new Roots([], store, root, () => Promise.resolve({ candidates: [], truncated: false }));
  const onboarding = new Onboarding({
    engine,
    config,
    store,
    roots,
    resolveLogin: () => Promise.resolve('jane'),
    run: () => Promise.resolve({ ok: true, code: 0, stdout: 'v1', stderr: '', timedOut: false }),
    models: { listModels: () => Promise.resolve([]) },
    accounts: () => Promise.resolve([]),
    accountActions: { listImports: () => Promise.resolve([]), importAccount: () => Promise.resolve() },
  });
  return { root, engine, onboarding, acme, projects, repos };
}

function answerFolders(world: Awaited<ReturnType<typeof setup>>) {
  return world.onboarding.setup.reply({
    type: 'answer',
    stepId: 'roots',
    values: [world.acme, world.projects],
  });
}

function answerProjects(onboarding: Onboarding, projects?: OnboardingProjectChoice[]) {
  return onboarding.setup.reply({
    type: 'answer',
    stepId: 'projects',
    values: ['continue'],
    ...(projects ? { projects } : {}),
  });
}

function listProjects(engine: Engine) {
  return Object.values(engine.state.projects).map((project) => ({
    name: project.name,
    key: project.key,
    folders: project.folders,
    repos: Object.values(engine.state.repos)
      .filter((repo) => repo.projectId === project.id)
      .map((repo) => repo.name)
      .sort(),
  }));
}

describe('the projects step', () => {
  test('after the folders it shows the projects Shinsa suggests from the repositories in them', async () => {
    const world = await setup();
    const flow = await answerFolders(world);
    expect(flow.steps.map((step) => step.id).slice(0, 2)).toEqual(['roots', 'projects']);
    expect(flow.step).toMatchObject({
      id: 'projects',
      title: 'Shinsa sorted your repositories into projects',
      submitLabel: 'Create 2 projects',
    });
    expect(flow.step?.projects.map((project) => [project.id, project.name, project.folders])).toEqual([
      ['owner:acme', 'Acme', [world.acme]],
      ['personal', 'Personal', []],
    ]);
    expect(flow.step?.projects[1]?.repos.map((repo) => repo.name)).toEqual(['notes', 'scratch']);
  });

  test('continuing as suggested creates every project and files each repository in it', async () => {
    const world = await setup();
    await answerFolders(world);
    const next = await answerProjects(world.onboarding);
    expect(next.step?.id).toBe('defaults');
    expect(next.steps[1]?.summary).toBe('2 projects');
    expect(listProjects(world.engine)).toEqual([
      { name: 'Acme', key: 'ACM', folders: [world.acme], repos: ['api', 'web'] },
      { name: 'Personal', key: 'PER', folders: [], repos: ['notes', 'scratch'] },
    ]);
    expect(Object.values(world.engine.state.repos).find((repo) => repo.name === 'api')?.remote).toBe(
      'github.com/acme/api'
    );
  });

  test('a renamed project keeps its new name, a repository left out stays unfiled, and so does its folder', async () => {
    const world = await setup();
    await answerFolders(world);
    await answerProjects(world.onboarding, [
      { id: 'owner:acme', name: '  Acme Corp ', repos: [world.repos.api] },
    ]);
    expect(listProjects(world.engine)).toEqual([
      { name: 'Acme Corp', key: 'ACM', folders: [], repos: ['api'] },
    ]);
    expect(Object.values(world.engine.state.repos).map((repo) => repo.name)).toEqual(['api']);
  });

  test('leaving every project out moves on and creates nothing', async () => {
    const world = await setup();
    await answerFolders(world);
    const next = await answerProjects(world.onboarding, []);
    expect(next.step?.id).toBe('defaults');
    expect(next.steps[1]?.summary).toBeNull();
    expect(world.engine.state.projects).toEqual({});
  });

  test('a choice it cannot carry out stays on the step and says why', async () => {
    const world = await setup();
    await answerFolders(world);
    for (const [choice, problem] of [
      [
        { id: 'owner:gone', name: 'Gone', repos: [] },
        'The suggested projects changed. Look them over again.',
      ],
      [{ id: 'personal', name: ' ', repos: [world.repos.notes] }, 'Name every project you keep.'],
      [
        { id: 'personal', name: 'x'.repeat(81), repos: [world.repos.notes] },
        'A project name is at most 80 characters.',
      ],
      [
        { id: 'personal', name: 'Mine', repos: ['/somewhere/else'] },
        'Keep at least one repository in Mine, or leave it out.',
      ],
    ] as const) {
      const flow = await answerProjects(world.onboarding, [{ ...choice, repos: [...choice.repos] }]);
      expect(flow.step).toMatchObject({ id: 'projects', problem });
    }
    expect(world.engine.state.projects).toEqual({});
  });

  test('a project you already have takes the repositories that match its name, and filed ones are not offered again', async () => {
    const world = await setup();
    await world.engine.dispatch({
      type: 'project.write',
      project: { name: 'Personal', color: 'green', key: 'ME' },
    });
    await answerFolders(world);
    await answerProjects(world.onboarding);
    expect(listProjects(world.engine)).toEqual([
      { name: 'Personal', key: 'ME', folders: [], repos: ['notes', 'scratch'] },
      { name: 'Acme', key: 'ACM', folders: [world.acme], repos: ['api', 'web'] },
    ]);
    const again = await world.onboarding.setup.reply({ type: 'open', stepId: 'projects' });
    expect(again.step).toMatchObject({
      projects: [],
      description: 'Every repository in your folders already belongs to a project.',
      submitLabel: 'Continue',
    });
  });

  test('a repository already in another project stays there, and its folder is not given to the new one', async () => {
    const world = await setup();
    await world.engine.dispatch({
      type: 'project.write',
      project: { name: 'Old', color: 'green', key: 'OLD' },
    });
    const old = Object.values(world.engine.state.projects)[0];
    await world.engine.dispatch({
      type: 'repo.register',
      repo: {
        path: world.repos.api,
        name: 'api',
        defaultBranch: 'main',
        remote: 'github.com/acme/api',
        checkCommands: [],
      },
      projectName: null,
      projectId: old?.id ?? null,
    });
    await createRepo(world.acme, 'cli', 'acme/cli');
    const flow = await answerFolders(world);
    expect(flow.step?.projects[0]).toMatchObject({ name: 'Acme', folders: [] });
    await answerProjects(world.onboarding);
    expect(listProjects(world.engine).slice(0, 2)).toEqual([
      { name: 'Old', key: 'OLD', folders: [], repos: ['api'] },
      { name: 'Acme', key: 'ACM', folders: [], repos: ['cli', 'web'] },
    ]);
  });

  test('a repository Shinsa registered deeper in a folder, outside any project, is offered too', async () => {
    const world = await setup();
    const deep = await createRepo(join(world.acme, 'tools'), 'cli', 'acme/cli');
    await world.engine.dispatch({
      type: 'repo.register',
      repo: {
        path: deep,
        name: 'cli',
        defaultBranch: 'main',
        remote: 'github.com/acme/cli',
        checkCommands: [],
      },
      projectName: null,
      projectId: null,
    });
    await world.engine.dispatch({
      type: 'repo.register',
      repo: { path: '/elsewhere/far', name: 'far', defaultBranch: 'main', remote: null, checkCommands: [] },
      projectName: null,
      projectId: null,
    });
    const flow = await answerFolders(world);
    expect(flow.step?.projects[0]?.repos.map((repo) => repo.name)).toEqual(['api', 'cli', 'web']);
    expect(flow.step?.projects.flatMap((project) => project.repos.map((repo) => repo.name))).not.toContain(
      'far'
    );
  });

  test('with no repositories in the folders it says Shinsa files them as it goes', async () => {
    const world = await setup();
    const empty = join(world.root, 'Empty');
    mkdirSync(empty);
    const flow = await world.onboarding.setup.reply({ type: 'answer', stepId: 'roots', values: [empty] });
    expect(flow.step).toMatchObject({ id: 'projects', projects: [], submitLabel: 'Continue' });
    expect(flow.step?.description).toContain('first time it works there');
    const next = await answerProjects(world.onboarding);
    expect(next.steps[1]?.summary).toBeNull();
  });

  test('one project is created as the project, and a single project reads as one', async () => {
    const world = await setup();
    const flow = await world.onboarding.setup.reply({
      type: 'answer',
      stepId: 'roots',
      values: [world.acme],
    });
    expect(flow.step?.submitLabel).toBe('Create the project');
    const next = await answerProjects(world.onboarding);
    expect(next.steps[1]?.summary).toBe('1 project');
  });

  test('refuses project choices it cannot read', async () => {
    const world = await setup();
    await answerFolders(world);
    for (const projects of [
      'all',
      [{ id: 'personal', name: 'Mine' }],
      [{ id: 'personal', name: 'Mine', repos: [3] }],
      [null],
      Array.from({ length: 51 }, () => ({ id: 'personal', name: 'Mine', repos: [] })),
    ]) {
      await expect(
        world.onboarding.setup.reply({ type: 'answer', stepId: 'projects', values: ['continue'], projects })
      ).rejects.toMatchObject({ code: 'projects_invalid' });
    }
  });
});
