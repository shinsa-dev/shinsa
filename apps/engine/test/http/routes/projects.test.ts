import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import { createGitRepo, createTempDir } from '../../helpers/index.ts';
import { createTestMachine } from '../../helpers/machine.ts';
import { disposeWebHandlers } from '../../helpers/web.ts';
import { readFailure, startMachineRoutes, startRoutes } from './harness.ts';

afterEach(disposeWebHandlers);

async function setup(roots: string[] = []) {
  const home = createTempDir();
  const routes = await startMachineRoutes(
    async ({ engine, config }) => ({
      roots: { listRoots: Effect.succeed(roots) },
      projects: (await createTestMachine(engine, config)).projects,
    }),
    { userHome: home }
  );
  const { engine } = routes.context;
  const call = async (method: 'GET' | 'POST', path: string, body?: unknown) => {
    const response = await (method === 'GET'
      ? routes.send(path)
      : routes.post(path, body === undefined ? {} : body));
    if (!response.ok) {
      const failure = await readFailure(response);
      throw Object.assign(new Error(failure.message), failure);
    }
    return (await response.json()) as Record<string, unknown>;
  };
  await engine.dispatch({
    type: 'project.write',
    project: { name: 'Basket', color: 'blue', description: 'Shopping' },
  });
  const projectId = Object.keys(engine.state.projects)[0] ?? '';
  return { home, engine, call, projectId };
}

describe('a project’s repositories and folders over HTTP', () => {
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

  test('every registered repository says which coverage tool Auto would use, or none', async () => {
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
          command: "The test checks of each task, run once more with go test's coverage report.",
        },
        [ids.web ?? '']: null,
      },
    });
  });

  test('without the chosen folders the project routes are not found, and a missing login resolver uses the home one', async () => {
    const bare = startRoutes();
    expect((await bare.send('/api/repos/local')).status).toBe(404);
    expect((await bare.send('/api/repos/coverage')).status).toBe(404);
    expect((await bare.post('/api/projects/x/repos', { path: '/tmp' })).status).toBe(404);
    expect((await bare.post('/api/projects/x/folders', { path: '/tmp' })).status).toBe(404);
    const roots = await startMachineRoutes(async ({ engine, config }) => ({
      roots: { listRoots: Effect.succeed([]) },
      projects: (await createTestMachine(engine, config, { resolveLogin: undefined })).projects,
    }));
    expect(await readFailure(await roots.post('/api/projects/x/repos', { path: '/tmp' }))).toMatchObject({
      code: 'project_not_found',
    });
  });
});
