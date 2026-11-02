import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ServiceDefinition, ServiceSuggestion, TerminalInfo, TerminalsSnapshot } from '@shinsa/core';
import { ServiceRefiner, Terminals } from '../../../src/terminals/index.ts';
import { createTempDir, until } from '../../helpers/index.ts';
import { disposeWebHandlers } from '../../helpers/web.ts';
import { startRoutes } from './harness.ts';

setDefaultTimeout(30_000);

const ORIGIN = 'http://localhost:5181';

const NO_PREVIEW = { previewUrl: null, portVariable: 'PORT' };

const running: Terminals[] = [];

afterEach(async () => {
  for (const terminals of running.splice(0)) await terminals.stop();
  await disposeWebHandlers();
});

async function start(options: { refiner?: ServiceRefiner } = {}) {
  const root = createTempDir();
  const terminals = new Terminals({
    dataDir: join(root, 'data'),
    home: root,
    version: '1.0.0',
    env: { SHELL: '/bin/sh', PATH: '/usr/bin:/bin', PS1: '$ ', HOME: root },
    notifyMs: 1,
  });
  running.push(terminals);
  const routes = startRoutes({ terminals, ...(options.refiner ? { refiner: options.refiner } : {}) });
  const { engine } = routes.context;
  const repoPath = join(root, 'web');
  mkdirSync(repoPath);
  await engine.dispatch({
    type: 'repo.register',
    repo: { name: 'web', path: repoPath, defaultBranch: 'main', remote: null, checkCommands: [] },
    projectName: 'Shop',
  });
  const projectId = Object.keys(engine.state.projects)[0] ?? '';
  const post = (path: string, body: unknown, origin: string | null = ORIGIN) =>
    routes.send(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const read = async <T>(path: string) => (await (await routes.send(path)).json()) as T;
  return { post, read, projectId, repoPath, terminals, engine, root };
}

async function readCode(response: Response) {
  return ((await response.json()) as { error: { code: string } }).error.code;
}

describe('terminals over HTTP', () => {
  test('opens one with a command, names, orders, lists, restarts and closes it', async () => {
    const { post, read, projectId, repoPath, terminals } = await start();
    const created = (await (
      await post('/api/terminals', { projectId, path: repoPath, command: 'echo "hi-$((6 * 7))"' })
    ).json()) as { terminal: TerminalInfo };
    expect(created.terminal).toMatchObject({
      projectId,
      cwd: repoPath,
      place: 'repository',
      status: 'running',
    });
    await until('the command ran', async () =>
      (await terminals.find(created.terminal.id).serializeScreen()).includes('hi-42')
    );
    expect(await read(`/api/terminals/${created.terminal.id}/foreground`)).toEqual({ program: null });
    const second = (
      (await (await post('/api/terminals', { projectId, path: repoPath })).json()) as {
        terminal: TerminalInfo;
      }
    ).terminal;
    await post(`/api/terminals/${created.terminal.id}/rename`, { name: 'Server' });
    await post('/api/terminals/order', { projectId, ids: [second.id, created.terminal.id, 7] });
    const listed = await read<TerminalsSnapshot>('/api/terminals');
    expect(listed.terminals.map((each) => [each.id, each.name])).toEqual([
      [second.id, null],
      [created.terminal.id, 'Server'],
    ]);
    await post(`/api/terminals/${created.terminal.id}/rename`, { name: null });
    await post('/api/terminals/order', { projectId, ids: 'none' });
    const restarted = (await (
      await post(`/api/terminals/${second.id}/restart`, {})
    ).json()) as TerminalsSnapshot;
    expect(restarted.terminals.find((each) => each.id === second.id)?.status).toBe('running');
    const closed = (await (await post(`/api/terminals/${second.id}/close`, {})).json()) as TerminalsSnapshot;
    expect(closed.terminals.map((each) => each.id)).toEqual([created.terminal.id]);
  });

  test('refuses a folder outside the project, a missing one, a missing project and a request without the page', async () => {
    const { post, projectId, repoPath, terminals } = await start();
    expect(await readCode(await post('/api/terminals', { projectId, path: '/etc' }))).toBe(
      'terminal_place_invalid'
    );
    expect(await readCode(await post('/api/terminals', { projectId: 'nope', path: repoPath }))).toBe(
      'project_not_found'
    );
    expect(await readCode(await post('/api/terminals', { projectId, path: '' }))).toBe('body_invalid');
    expect(await readCode(await post('/api/terminals', { path: repoPath }))).toBe('body_invalid');
    expect((await post('/api/terminals', { projectId, path: repoPath }, null)).status).toBe(400);
    expect((await post('/api/terminals', { projectId, path: repoPath }, 'https://evil.example')).status).toBe(
      403
    );
    rmSync(repoPath, { recursive: true });
    expect(await readCode(await post('/api/terminals', { projectId, path: repoPath }))).toBe(
      'terminal_place_missing'
    );
    expect(terminals.snapshot().terminals).toEqual([]);
  });

  test('without terminals every terminal and service route is not found', async () => {
    const routes = startRoutes();
    expect((await routes.send('/api/terminals')).status).toBe(404);
    expect((await routes.send('/api/services/suggestions?projectId=x')).status).toBe(404);
    expect((await routes.post('/api/services/x/start', {})).status).toBe(404);
  });
});

describe('services over HTTP', () => {
  test('refines the suggestions when asked, leaving out a name the project already has', async () => {
    const answers: unknown[] = [
      {
        services: [
          {
            index: 0,
            name: 'gateway',
            command: 'npm run dev',
            previewUrl: '',
            portVariable: '',
            recommended: true,
          },
          {
            index: 1,
            name: 'web',
            command: 'npm run dev -- --port $PORT',
            previewUrl: 'http://localhost:{port}',
            portVariable: '',
            recommended: true,
          },
        ],
      },
    ];
    const refiner = new ServiceRefiner(<T>() => Promise.resolve((answers.shift() ?? null) as T | null));
    const { read, projectId, repoPath, terminals } = await start({ refiner });
    for (const app of ['api', 'site']) {
      mkdirSync(join(repoPath, `apps/${app}`), { recursive: true });
      writeFileSync(join(repoPath, `apps/${app}/package.json`), JSON.stringify({ scripts: { dev: 'x' } }));
    }
    writeFileSync(join(repoPath, 'package.json'), JSON.stringify({ workspaces: ['apps/*'] }));
    terminals.addService(projectId, { name: 'gateway', cwd: repoPath, command: 'x', env: {}, ...NO_PREVIEW });
    const plain = await read<{ suggestions: ServiceSuggestion[]; refined: boolean }>(
      `/api/services/suggestions?projectId=${projectId}`
    );
    expect(plain.refined).toBe(false);
    expect(plain.suggestions.map((each) => each.name)).toEqual(['api', 'site']);
    const refined = await read<{ suggestions: ServiceSuggestion[]; refined: boolean }>(
      `/api/services/suggestions?projectId=${projectId}&refine=1`
    );
    expect(refined.refined).toBe(true);
    expect(refined.suggestions.map((each) => [each.name, each.command, each.previewUrl])).toEqual([
      ['web', 'npm run dev -- --port $PORT', 'http://localhost:{port}'],
    ]);
    expect(await read('/api/services/suggestions')).toMatchObject({ error: { code: 'project_not_found' } });
  });

  test('adds, starts, stops, restarts, edits, starts all and removes a service', async () => {
    const { post, projectId, repoPath, terminals } = await start();
    mkdirSync(join(repoPath, 'apps/api'), { recursive: true });
    const added = await post('/api/services', {
      projectId,
      name: ' api ',
      path: join(repoPath, 'apps/api'),
      command: 'echo "up-$PORT"; sleep 30',
      env: { PORT: '4100' },
      previewUrl: ' http://localhost:{port}/tasks ',
    });
    const { service } = (await added.json()) as { service: ServiceDefinition };
    expect(service).toMatchObject({
      name: 'api',
      env: { PORT: '4100' },
      previewUrl: 'http://localhost:{port}/tasks',
    });
    const started = (await (await post(`/api/services/${service.id}/start`, {}, null)).json()) as {
      terminal: TerminalInfo;
    };
    expect(started.terminal).toMatchObject({ serviceId: service.id, status: 'running', port: 4100 });
    await post(`/api/services/${service.id}/stop`, {}, null);
    expect(terminals.find(started.terminal.id).info.status).toBe('stopped');
    const restarted = (await (await post(`/api/services/${service.id}/restart`, {}, null)).json()) as {
      terminal: TerminalInfo;
    };
    expect(restarted.terminal.status).toBe('running');
    await post(`/api/services/${service.id}/update`, {
      name: 'broken',
      path: repoPath,
      command: 'exit 4',
      env: {},
    });
    await post(`/api/services/${service.id}/restart`, undefined, null);
    await until('it failed', () => terminals.find(started.terminal.id).info.exitCode === 4);
    await post('/api/services/start-all', { projectId }, null);
    expect(terminals.find(started.terminal.id).info.status).toBe('running');
    expect(await readCode(await post('/api/services/start-all', { projectId: 'nope' }, null))).toBe(
      'project_not_found'
    );
    const removed = (await (
      await post('/api/services/remove', { ids: [service.id] })
    ).json()) as TerminalsSnapshot;
    expect(removed).toMatchObject({ services: [], terminals: [] });
  });

  test('adds several services at once, checking every one before it adds any', async () => {
    const { post, projectId, repoPath, terminals } = await start();
    const one = { name: 'api', path: repoPath, command: 'bun run dev', env: {} };
    const refusal = async (body: unknown) => readCode(await post('/api/services/batch', body));
    expect(await refusal({ projectId, services: [] })).toBe('body_invalid');
    expect(await refusal({ projectId, services: [one, 3] })).toBe('body_invalid');
    expect(await refusal({ projectId, services: [one, { ...one, name: 'API' }] })).toBe('service_name_taken');
    expect(await refusal({ projectId: 'nope', services: [one] })).toBe('project_not_found');
    for (let index = 0; index < 31; index += 1)
      terminals.addService(projectId, {
        name: `s${index}`,
        cwd: repoPath,
        command: 'x',
        env: {},
        ...NO_PREVIEW,
      });
    expect(await refusal({ projectId, services: [one, { ...one, name: 'web' }] })).toBe('service_limit');
    for (const service of terminals.snapshot().services) terminals.removeServices([service.id]);
    const added = (await (
      await post('/api/services/batch', { projectId, services: [one, { ...one, name: 'web' }] })
    ).json()) as { added: ServiceDefinition[] } & TerminalsSnapshot;
    expect(added.added.map((service) => service.name)).toEqual(['api', 'web']);
  });

  test('refuses a bad service, a missing one and a change without the page', async () => {
    const { post, projectId, repoPath, terminals } = await start();
    const service = { projectId, name: 'web', path: repoPath, command: 'bun dev', env: {} };
    const refusal = async (body: unknown, origin: string | null = ORIGIN) =>
      readCode(await post('/api/services', body, origin));
    expect(await refusal({ ...service, name: '  ' })).toBe('body_invalid');
    expect(await refusal({ ...service, path: '/etc' })).toBe('service_place_invalid');
    expect(await refusal({ ...service, projectId: 'nope' })).toBe('project_not_found');
    expect(await refusal(service, null)).toBe('browser_only');
    expect(await readCode(await post('/api/services/remove', { ids: ['gone'] }))).toBe('service_not_found');
    expect(await readCode(await post('/api/services/gone/update', service))).toBe('service_not_found');
    expect(await readCode(await post('/api/services/gone/start', {}, null))).toBe('service_not_found');
    const { service: added } = (await (await post('/api/services', service)).json()) as {
      service: ServiceDefinition;
    };
    rmSync(repoPath, { recursive: true });
    expect(await readCode(await post(`/api/services/${added.id}/start`, {}, null))).toBe(
      'terminal_place_missing'
    );
    const stray = terminals.addService(projectId, {
      name: 'x',
      cwd: '/etc',
      command: 'ls',
      env: {},
      ...NO_PREVIEW,
    });
    expect(await readCode(await post(`/api/services/${stray.id}/start`, {}, null))).toBe(
      'service_place_invalid'
    );
  });

  test('starts, restarts and stops a service in a task’s worktree beside its main run', async () => {
    const { post, projectId, repoPath, root, terminals, engine } = await start();
    const appPath = join(repoPath, 'apps/api');
    mkdirSync(appPath, { recursive: true });
    const service = terminals.addService(projectId, {
      name: 'api',
      cwd: appPath,
      command: 'sleep 30',
      env: {},
      ...NO_PREVIEW,
    });
    const repoId = Object.keys(engine.state.repos)[0] ?? '';
    await engine.dispatch({ type: 'task.create', request: 'Change the api', repoId });
    const taskId = Object.keys(engine.state.tasks)[0] ?? '';
    await engine.dispatch({
      type: 'task.triage',
      taskId,
      title: 'Change the api',
      repoId,
      size: 'small',
      branch: 'feat/api',
      waitsOn: [],
    });
    const worktree = join(root, 'wt');
    await engine.dispatch({ type: 'worktree.ready', taskId, path: worktree, branch: 'feat/api' });
    const call = async (id: string, action: string, body: unknown) =>
      (await (await post(`/api/services/${id}/${action}`, body, null)).json()) as TerminalsSnapshot & {
        terminal?: TerminalInfo;
        error?: { code: string; message: string };
      };
    mkdirSync(join(worktree, 'apps/api'), { recursive: true });
    const started = await call(service.id, 'start', { taskId });
    expect(started.terminal).toMatchObject({ taskId, place: 'worktree', cwd: join(worktree, 'apps/api') });
    const onMain = await call(service.id, 'start', undefined);
    expect(onMain.terminal).toMatchObject({ taskId: null, cwd: appPath });
    const restarted = await call(service.id, 'restart', { taskId });
    expect(restarted.terminal?.id).toBe(started.terminal?.id);
    const stopped = await call(service.id, 'stop', { taskId });
    expect(stopped.terminals.map((each) => [each.taskId, each.status])).toEqual([
      [taskId, 'stopped'],
      [null, 'running'],
    ]);
    expect((await call(service.id, 'start', { taskId: 'nope' })).error?.code).toBe('task_not_found');
    expect((await call(service.id, 'start', { taskId: 7 })).error?.code).toBe('body_invalid');
    const outside = terminals.addService(projectId, {
      name: 'notes',
      cwd: root,
      command: 'ls',
      env: {},
      ...NO_PREVIEW,
    });
    const refused = await call(outside.id, 'start', { taskId });
    expect(refused.error?.message).toBe('It cannot run in this task.');
  });
});
