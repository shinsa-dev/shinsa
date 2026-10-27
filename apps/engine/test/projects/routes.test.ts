import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { createProjectChanges, createProjectRoutes } from '../../src/projects/routes.ts';
import { Engine } from '../../src/runtime/index.ts';
import { EventLog } from '../../src/store/index.ts';
import { createGitRepo, createTempDir, overrideEnv } from '../helpers/index.ts';

const logs: EventLog[] = [];

afterEach(() => {
  for (const log of logs.splice(0)) log.close();
});

async function setup(roots: string[] = []) {
  const home = createTempDir();
  const log = new EventLog(join(createTempDir(), 'events.db'));
  logs.push(log);
  const engine = new Engine(log);
  const routes = createProjectRoutes({
    engine,
    roots: { listRoots: () => Promise.resolve(roots) },
    resolveLogin: () => Promise.resolve(null),
    userHome: home,
  });
  async function call(method: 'GET' | 'POST', path: string, body?: unknown) {
    const route = routes.find((candidate) => candidate.method === method && candidate.pattern.test(path));
    if (!route) throw new Error(`no route ${method} ${path}`);
    const match = route.pattern.exec(path) as RegExpExecArray;
    const request = new Request(`http://127.0.0.1${path}`, {
      method,
      ...(body === undefined
        ? {}
        : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
    });
    return (await route.respond(match, request)).json() as Promise<Record<string, unknown>>;
  }
  await engine.dispatch({
    type: 'project.write',
    project: { name: 'Basket', color: 'blue', description: 'Shopping' },
  });
  const projectId = Object.keys(engine.state.projects)[0] ?? '';
  return { home, engine, log, call, projectId };
}

describe('a project’s repositories and folders', () => {
  test('a repository is registered into the project, and one already registered elsewhere moves', async () => {
    const { home, engine, call, projectId } = await setup();
    const server = await createGitRepo({ root: home, name: 'server', remote: false });
    const added = await call('POST', `/api/projects/${projectId}/repos`, { path: '~/server' });
    const path = realpathSync(server.path);
    expect(added.repo).toMatchObject({ name: 'server', path, projectId });

    await engine.dispatch({ type: 'project.write', project: { name: 'Other', color: 'green' } });
    const otherId = Object.keys(engine.state.projects).find((id) => id !== projectId) ?? '';
    const moved = await call('POST', `/api/projects/${otherId}/repos`, { path });
    expect(moved.repo).toMatchObject({ path, projectId: otherId });
    expect(Object.values(engine.state.repos)).toHaveLength(1);
  });

  test('a folder joins the project, and every registered repository inside it moves in', async () => {
    const { home, engine, call, projectId } = await setup();
    const folder = join(home, 'basket');
    const ios = await createGitRepo({ root: folder, name: 'ios', remote: false });
    await engine.dispatch({ type: 'project.write', project: { name: 'Other', color: 'green' } });
    const otherId = Object.keys(engine.state.projects).find((id) => id !== projectId) ?? '';
    await call('POST', `/api/projects/${otherId}/repos`, { path: ios.path });
    const answered = await call('POST', `/api/projects/${projectId}/folders`, { path: '~/basket' });
    expect(answered.project).toMatchObject({ id: projectId, folders: [realpathSync(folder)] });
    expect(Object.values(engine.state.repos)[0]?.projectId).toBe(projectId);
  });

  test('a folder added on your behalf is logged as such, and adding it again changes nothing', async () => {
    const { home, engine, projectId } = await setup();
    mkdirSync(join(home, 'basket'));
    const changes = createProjectChanges({
      engine,
      resolveLogin: () => Promise.resolve(null),
      userHome: home,
    });
    await changes.upsertFolder(projectId, '~/basket', { onBehalf: true, byTask: 'task-1' });
    const again = await changes.upsertFolder(projectId, '~/basket', { onBehalf: true, byTask: 'task-1' });
    expect(again.project.folders).toEqual([realpathSync(join(home, 'basket'))]);
    expect(engine.state.onBehalfActions?.map((action) => action.byTaskId)).toEqual(['task-1']);
  });

  test('a repository added on your behalf is registered as yours from that task, and records no action', async () => {
    const { home, engine, log, projectId } = await setup();
    const repo = await createGitRepo({ root: home, name: 'basket', remote: false });
    const changes = createProjectChanges({
      engine,
      resolveLogin: () => Promise.resolve(null),
      userHome: home,
    });
    const { repo: added } = await changes.upsertRepo(projectId, repo.path, {
      onBehalf: true,
      byTask: 'task-1',
    });
    expect(added.projectId).toBe(projectId);
    expect(log.readEvents().events.find((event) => event.type === 'repo.registered')).toMatchObject({
      onBehalf: true,
      byTask: 'task-1',
    });
    expect(engine.state.onBehalfActions).toEqual([]);
  });

  test('a missing project, a path that is not a folder and a folder that is not a repository are refused', async () => {
    const { home, call, projectId } = await setup();
    mkdirSync(join(home, 'plain'));
    await expect(call('POST', '/api/projects/nope/repos', { path: home })).rejects.toMatchObject({
      code: 'project_not_found',
    });
    for (const path of ['', 'relative/path', 42, '~/missing']) {
      await expect(call('POST', `/api/projects/${projectId}/folders`, { path })).rejects.toMatchObject({
        code: 'folder_invalid',
      });
    }
    await expect(call('POST', `/api/projects/${projectId}/repos`, { path: '~/plain' })).rejects.toMatchObject(
      {
        code: 'repo_invalid',
        message: `${realpathSync(join(home, 'plain'))} is not a git repository.`,
      }
    );
  });

  test('the local repositories are the registered ones and those in the chosen and project folders', async () => {
    const root = createTempDir();
    const { home, engine, call, projectId } = await setup([root]);
    const loose = await createGitRepo({ root, name: 'loose', remote: false });
    mkdirSync(join(root, 'notes'));
    const folder = join(home, 'basket');
    const web = await createGitRepo({ root: folder, name: 'web', remote: false });
    const registered = await createGitRepo({ root: home, name: 'app', remote: false });
    await call('POST', `/api/projects/${projectId}/repos`, { path: registered.path });
    await call('POST', `/api/projects/${projectId}/folders`, { path: folder });
    const repoId = Object.keys(engine.state.repos)[0];
    expect((await call('GET', '/api/repos/local')).repos).toEqual([
      { path: realpathSync(registered.path), name: 'app', repoId, projectId },
      { path: realpathSync(loose.path), name: 'loose', repoId: null, projectId: null },
      { path: realpathSync(web.path), name: 'web', repoId: null, projectId },
    ]);
  });

  test('every registered repository says whether GitButler can hold its agents', async () => {
    const { home, engine, call, projectId } = await setup();
    const app = await createGitRepo({ root: home, name: 'app', remote: false });
    await call('POST', `/api/projects/${projectId}/repos`, { path: app.path });
    const repoId = Object.keys(engine.state.repos)[0] ?? '';
    const newer = overrideEnv({ FAKE_BUT_VERSION: '0.23.0' });
    expect(await call('GET', '/api/repos/workspaces')).toEqual({
      support: { [repoId]: { butInstalled: true, gitButlerWorkspace: true } },
    });
    newer();
    const older = overrideEnv({ FAKE_BUT_VERSION: '0.22.3' });
    expect(await call('GET', '/api/repos/workspaces')).toEqual({
      support: { [repoId]: { butInstalled: true, gitButlerWorkspace: false } },
    });
    older();
  });

  test('every registered repository says which coverage command Auto would run, or none', async () => {
    const { home, engine, call, projectId } = await setup();
    const app = await createGitRepo({
      root: home,
      name: 'app',
      remote: false,
      files: { 'go.mod': 'module example.com/app\n' },
    });
    const web = await createGitRepo({ root: home, name: 'web', remote: false });
    await call('POST', `/api/projects/${projectId}/repos`, { path: app.path });
    await call('POST', `/api/projects/${projectId}/repos`, { path: web.path });
    const ids = Object.fromEntries(Object.values(engine.state.repos).map((repo) => [repo.name, repo.id]));
    expect(await call('GET', '/api/repos/coverage')).toEqual({
      detected: {
        [ids.app ?? '']: {
          tool: 'go test',
          command: "go test ./... -coverprofile='<report folder>/cover.out'",
        },
        [ids.web ?? '']: null,
      },
    });
  });
});
