import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ServerMessage,
  ServiceDefinition,
  ServiceSuggestion,
  TerminalInfo,
  TerminalsSnapshot,
} from '@shinsa/core';
import type { ModelSource } from '../../src/agents/index.ts';
import { Transcripts } from '../../src/agents/index.ts';
import { startServer } from '../../src/http/index.ts';
import { createSocketHandlers } from '../../src/http/server.ts';
import { Engine } from '../../src/runtime/index.ts';
import { EventLog, EvidenceStore } from '../../src/store/index.ts';
import { ServiceRefiner, Terminals } from '../../src/terminals/index.ts';
import {
  createTerminalSockets,
  resolveServicePlace,
  resolveServiceRunIn,
  resolveTerminalStart,
  type TerminalSocketData,
} from '../../src/terminals/routes.ts';
import {
  createTempDir,
  createTestConfig,
  createTestOnboarding,
  until,
  writeFiles,
} from '../helpers/index.ts';
import { createFakeSpawner, createFakeViewer } from './fakes.ts';

setDefaultTimeout(30_000);

const ORIGIN = 'http://localhost:5181';

const NO_PREVIEW = { previewUrl: null, portVariable: 'PORT' };

const running: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const stop of running.splice(0)) await stop();
});

async function start(options: { inspect?: boolean; refiner?: ServiceRefiner } = {}) {
  const root = createTempDir();
  const config = createTestConfig(root, { inspect: options.inspect ?? false });
  const engine = new Engine(new EventLog(config.databasePath));
  const terminals = new Terminals({
    dataDir: config.dataDir,
    home: root,
    version: '1.0.0',
    env: { SHELL: '/bin/sh', PATH: '/usr/bin:/bin', PS1: '$ ', HOME: root },
    notifyMs: 1,
  });
  const http = startServer({
    engine,
    config,
    transcripts: new Transcripts(config.transcriptsDir),
    evidence: new EvidenceStore(config.evidenceDir),
    models: { listModels: () => Promise.resolve([]) } as unknown as ModelSource,
    onboarding: createTestOnboarding(engine, config).onboarding,
    terminals,
    ...(options.refiner ? { refiner: options.refiner } : {}),
  });
  running.push(async () => {
    await terminals.stop();
    await http.stop();
  });
  const repoPath = join(root, 'web');
  mkdirSync(repoPath);
  await engine.dispatch({
    type: 'repo.register',
    repo: { name: 'web', path: repoPath, defaultBranch: 'main', remote: null, checkCommands: [] },
    projectName: 'Shop',
  });
  const projectId = Object.keys(engine.state.projects)[0] ?? '';
  const base = `http://127.0.0.1:${http.server.port}`;
  const post = (path: string, body: unknown, origin: string | null = ORIGIN) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
      body: JSON.stringify(body),
    });
  const read = async <T>(path: string) => (await (await fetch(`${base}${path}`)).json()) as T;
  return { base, post, read, projectId, repoPath, terminals, engine, root };
}

function openSocket(url: string, origin: string | null) {
  const options = { headers: origin ? { origin } : {} };
  return new WebSocket(url, options as unknown as string[]);
}

function attach(base: string, id: string, origin: string | null = ORIGIN) {
  const socket = openSocket(`${base.replace('http', 'ws')}/ws/terminals/${id}`, origin);
  socket.binaryType = 'arraybuffer';
  const decoder = new TextDecoder();
  const state = { output: '', controls: [] as unknown[], closed: null as number | null };
  socket.addEventListener('message', (event) => {
    if (typeof event.data === 'string') state.controls.push(JSON.parse(event.data));
    else state.output += decoder.decode(event.data as ArrayBuffer, { stream: true });
  });
  socket.addEventListener('close', (event) => {
    state.closed = event.code;
  });
  const opened = new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve());
    socket.addEventListener('error', () => reject(new Error('socket refused')));
  });
  return { socket, state, opened };
}

describe('terminals over HTTP and their socket', () => {
  test('a real shell: open it, type, resize, watch it exit, start it again and close it', async () => {
    const { base, post, projectId, repoPath, terminals } = await start();
    const created = await post('/api/terminals', {
      projectId,
      path: repoPath,
      command: 'echo "hi-$((6 * 7))"',
    });
    const { terminal } = (await created.json()) as { terminal: TerminalInfo };
    expect(terminal).toMatchObject({ projectId, cwd: repoPath, place: 'repository', status: 'running' });

    const view = attach(base, terminal.id);
    await view.opened;
    await until('the command ran', () => view.state.output.includes('hi-42'));
    expect(view.state.controls[0]).toMatchObject({ type: 'reset' });

    view.socket.send(JSON.stringify({ type: 'resize', cols: 132, rows: 43 }));
    view.socket.send(
      JSON.stringify({
        type: 'colors',
        colors: { foreground: '#000000', background: '#ffffff', cursor: '#0000ff' },
      })
    );
    view.socket.send('not a frame');
    view.socket.send(new TextEncoder().encode('stty size; pwd\r'));
    await until('the shell sees the new size', () => view.state.output.includes('43 132'));
    await until('the shell is in the folder', () => view.state.output.includes(realpathSync(repoPath)));

    view.socket.send(new TextEncoder().encode('exit 7\r'));
    await until('the exit is recorded', () => terminals.select(terminal.id)?.info.status === 'exited');
    expect(terminals.select(terminal.id)?.info.exitCode).toBe(7);

    const again = attach(base, terminal.id);
    await again.opened;
    await until('a second viewer sees the old output', () => again.state.output.includes('hi-42'));
    again.socket.close();
    view.socket.send('{"type":"clear"}');

    const restarted = (await (
      await post(`/api/terminals/${terminal.id}/restart`, {})
    ).json()) as TerminalsSnapshot;
    expect(restarted.terminals[0]?.status).toBe('running');
    view.socket.send(new TextEncoder().encode('echo back\r'));
    await until('the new shell answers', () => view.state.output.includes('back'));

    const closed = (await (
      await post(`/api/terminals/${terminal.id}/close`, {})
    ).json()) as TerminalsSnapshot;
    expect(closed.terminals).toEqual([]);
    await until('the viewer is told', () => view.state.closed === 4404);
  });

  test('names, orders and lists terminals, and pushes every change to the page’s socket', async () => {
    const { base, post, projectId, repoPath } = await start();
    const hub = openSocket(`${base.replace('http', 'ws')}/ws`, ORIGIN);
    const messages: ServerMessage[] = [];
    hub.addEventListener('message', (event) =>
      messages.push(JSON.parse(String(event.data)) as ServerMessage)
    );
    await until('the first snapshot', () => messages.some((message) => message.type === 'terminals'));
    const first = (
      (await (await post('/api/terminals', { projectId, path: repoPath })).json()) as {
        terminal: TerminalInfo;
      }
    ).terminal;
    const second = (
      (await (await post('/api/terminals', { projectId, path: repoPath })).json()) as {
        terminal: TerminalInfo;
      }
    ).terminal;
    await post(`/api/terminals/${first.id}/rename`, { name: 'Server' });
    await post('/api/terminals/order', { projectId, ids: [second.id, first.id, 7] });
    const listed = (await (await fetch(`${base}/api/terminals`)).json()) as TerminalsSnapshot;
    expect(listed.terminals.map((each) => [each.id, each.name])).toEqual([
      [second.id, null],
      [first.id, 'Server'],
    ]);
    await until('the socket has the order', () => {
      const last = messages.filter((message) => message.type === 'terminals').at(-1);
      return last?.type === 'terminals' && last.terminals.terminals[0]?.id === second.id;
    });
    await post(`/api/terminals/${first.id}/rename`, { name: null });
    hub.close();
  });

  test('refuses a folder outside the project, a missing one, a page from another site and any program', async () => {
    const { base, post, projectId, repoPath, terminals } = await start();
    expect(await (await post('/api/terminals', { projectId, path: '/etc' })).json()).toMatchObject({
      error: { code: 'terminal_place_invalid' },
    });
    expect(await (await post('/api/terminals', { projectId: 'nope', path: repoPath })).json()).toMatchObject({
      error: { code: 'project_not_found' },
    });
    expect(await (await post('/api/terminals', { projectId, path: '' })).json()).toMatchObject({
      error: { code: 'body_invalid' },
    });
    expect((await post('/api/terminals', { projectId, path: repoPath }, null)).status).toBe(400);
    expect((await post('/api/terminals', { projectId, path: repoPath }, 'https://evil.example')).status).toBe(
      403
    );
    rmSync(repoPath, { recursive: true });
    expect(await (await post('/api/terminals', { projectId, path: repoPath })).json()).toMatchObject({
      error: { code: 'terminal_place_missing' },
    });
    expect(terminals.snapshot().terminals).toEqual([]);
    await expect(attach(base, 'some-id', null).opened).rejects.toThrow('socket refused');
    const unknown = attach(base, 'some-id');
    await unknown.opened;
    await until('a closed terminal is refused', () => unknown.state.closed === 4404);
    expect((await fetch(`${base}/ws/terminals/bad.id`)).status).not.toBe(101);
  });

  test('opens in your home folder only for a project with no folders at all', () => {
    const home = createTempDir();
    expect(resolveTerminalStart([], 'p1', home, home)).toEqual({
      projectId: 'p1',
      cwd: home,
      place: 'folder',
      taskId: null,
    });
    expect(() => resolveTerminalStart([], 'p1', '/tmp', home)).toThrow('one of the project’s folders');
  });

  test('ignores messages and drains for a terminal closed under its socket', async () => {
    const { base, post, projectId, repoPath, terminals } = await start();
    const { terminal } = (await (await post('/api/terminals', { projectId, path: repoPath })).json()) as {
      terminal: TerminalInfo;
    };
    const view = attach(base, terminal.id);
    await view.opened;
    await until('the screen arrives', () => view.state.controls.length > 0);
    const session = terminals.find(terminal.id);
    terminals.select = () => null;
    view.socket.send('{"type":"resize","cols":90,"rows":20}');
    view.socket.close();
    await until('the socket closes', () => view.state.closed !== null);
    expect(session.viewers).toBe(1);
  });
});

describe('services over HTTP', () => {
  test('says whether a real shell has a program in front of it', async () => {
    const { base, post, read, projectId, repoPath } = await start();
    const { terminal } = (await (await post('/api/terminals', { projectId, path: repoPath })).json()) as {
      terminal: TerminalInfo;
    };
    const view = attach(base, terminal.id);
    await view.opened;
    view.socket.send(new TextEncoder().encode('echo ready\r'));
    await until('the shell answers', () => view.state.output.includes('ready'));
    expect(await read(`/api/terminals/${terminal.id}/foreground`)).toEqual({ program: null });
    view.socket.send(new TextEncoder().encode('sleep 30\r'));
    await until(
      'sleep is in front',
      async () =>
        (await read<{ program: string | null }>(`/api/terminals/${terminal.id}/foreground`)).program ===
        'sleep'
    );
    view.socket.send(new TextEncoder().encode('\u0003'));
    await until(
      'the shell is idle again',
      async () =>
        (await read<{ program: string | null }>(`/api/terminals/${terminal.id}/foreground`)).program === null
    );
  });

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
  });

  test('suggests, adds, starts, stops, restarts, edits and removes a service', async () => {
    const { post, read, projectId, repoPath, terminals } = await start();
    mkdirSync(join(repoPath, 'apps/api'), { recursive: true });
    writeFileSync(join(repoPath, 'package.json'), JSON.stringify({ workspaces: ['apps/*'] }));
    writeFileSync(join(repoPath, 'apps/api/package.json'), JSON.stringify({ scripts: { dev: 'x' } }));
    const { suggestions } = await read<{ suggestions: ServiceSuggestion[] }>(
      `/api/services/suggestions?projectId=${projectId}`
    );
    expect(suggestions).toEqual([
      {
        name: 'api',
        cwd: join(repoPath, 'apps/api'),
        command: 'npm run dev',
        source: 'package',
        recommended: true,
        previewUrl: null,
        portVariable: 'PORT',
      },
    ]);
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
      portVariable: 'PORT',
    });
    const left = await read<{ suggestions: ServiceSuggestion[] }>(
      `/api/services/suggestions?projectId=${projectId}`
    );
    expect(left.suggestions).toEqual([]);
    terminals.addService(projectId, {
      name: 'gateway',
      cwd: join(repoPath, 'apps/api'),
      command: 'npm run dev',
      env: {},
      ...NO_PREVIEW,
    });
    terminals.updateService(service.id, {
      name: 'renamed',
      cwd: service.cwd,
      command: service.command,
      env: service.env,
      previewUrl: service.previewUrl,
      portVariable: service.portVariable,
    });
    const same = await read<{ suggestions: ServiceSuggestion[] }>(
      `/api/services/suggestions?projectId=${projectId}`
    );
    expect(same.suggestions).toEqual([]);
    for (const each of terminals.snapshot().services)
      if (each.id !== service.id) terminals.removeServices([each.id]);

    const started = (await (await post(`/api/services/${service.id}/start`, {}, null)).json()) as {
      terminal: TerminalInfo;
    };
    expect(started.terminal).toMatchObject({ serviceId: service.id, status: 'running', port: 4100 });
    await until('it printed', async () =>
      (await terminals.find(started.terminal.id).serializeScreen()).includes('up-4100')
    );
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
    await post(`/api/services/${service.id}/restart`, {}, null);
    await until('it failed', () => terminals.find(started.terminal.id).info.exitCode === 4);
    await post('/api/services/start-all', { projectId }, null);
    expect(terminals.find(started.terminal.id).info.status).toBe('running');

    const removed = (await (
      await post('/api/services/remove', { ids: [service.id] })
    ).json()) as TerminalsSnapshot;
    expect(removed).toMatchObject({ services: [], terminals: [] });
  });

  test('adds several services at once, checking every one before it adds any', async () => {
    const { post, projectId, repoPath, terminals } = await start();
    const one = { name: 'api', path: repoPath, command: 'bun run dev', env: {} };
    const refusal = async (body: unknown) =>
      ((await (await post('/api/services/batch', body)).json()) as { error: { code: string } }).error.code;
    expect(await refusal({ projectId, services: [] })).toBe('body_invalid');
    expect(await refusal({ projectId, services: 'api' })).toBe('body_invalid');
    expect(await refusal({ projectId, services: [one, 3] })).toBe('body_invalid');
    expect(await refusal({ projectId, services: [one, { ...one, name: 'API' }] })).toBe('service_name_taken');
    expect(await refusal({ projectId, services: [one, { ...one, name: 'web', path: '/etc' }] })).toBe(
      'service_place_invalid'
    );
    expect(terminals.snapshot().services).toEqual([]);
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
    expect(added.services.map((service) => service.name)).toEqual(['api', 'web']);
  });

  test('removes several services at once, finding every one before it removes any', async () => {
    const { post, projectId, repoPath, terminals } = await start();
    const add = (name: string) =>
      terminals.addService(projectId, { name, cwd: repoPath, command: 'sleep 30', env: {}, ...NO_PREVIEW });
    const [api, web, docs] = [add('api'), add('web'), add('docs')];
    const started = terminals.startService(api.id, { cwd: repoPath, place: 'repository', taskId: null });
    const refusal = async (body: unknown, origin: string | null = ORIGIN) =>
      ((await (await post('/api/services/remove', body, origin)).json()) as { error: { code: string } }).error
        .code;
    expect(await refusal({ ids: [] })).toBe('body_invalid');
    expect(await refusal({ ids: 'api' })).toBe('body_invalid');
    expect(await refusal({ ids: [api.id, 3] })).toBe('body_invalid');
    expect(await refusal({ ids: [api.id, 'gone'] })).toBe('service_not_found');
    expect(await refusal({ ids: [api.id] }, null)).toBe('browser_only');
    expect(terminals.snapshot().services).toHaveLength(3);
    const removed = (await (
      await post('/api/services/remove', { ids: [api.id, web.id, api.id] })
    ).json()) as TerminalsSnapshot;
    expect(removed.services.map((service) => service.id)).toEqual([docs?.id]);
    expect(removed.terminals.map((terminal) => terminal.id)).not.toContain(started.id);
  });

  test('refuses a bad service, a folder outside the project and a change without the page', async () => {
    const { post, projectId, repoPath, root, terminals } = await start();
    const service = { projectId, name: 'web', path: repoPath, command: 'bun dev', env: {} };
    const refusal = async (body: unknown, origin: string | null = ORIGIN) =>
      ((await (await post('/api/services', body, origin)).json()) as { error: { code: string } }).error.code;
    expect(await refusal({ ...service, name: '  ' })).toBe('body_invalid');
    expect(await refusal({ ...service, command: '  ' })).toBe('body_invalid');
    expect(await refusal({ ...service, path: '/etc' })).toBe('service_place_invalid');
    expect(await refusal({ ...service, path: join(repoPath, 'gone') })).toBe('terminal_place_missing');
    expect(await refusal({ ...service, env: [] })).toBe('body_invalid');
    expect(await refusal({ ...service, env: { 'A-B': 'x' } })).toBe('service_env_invalid');
    expect(await refusal({ ...service, env: { A: 3 } })).toBe('service_env_invalid');
    const many = Object.fromEntries(Array.from({ length: 51 }, (_, index) => [`K${index}`, 'v']));
    expect(await refusal({ ...service, env: many })).toBe('body_invalid');
    expect(await refusal({ ...service, previewUrl: 'localhost:{port}' })).toBe('service_preview_invalid');
    expect(await refusal({ ...service, previewUrl: 'http://localhost:3000' })).toBe(
      'service_preview_invalid'
    );
    expect(await refusal({ ...service, previewUrl: 'x'.repeat(2001) })).toBe('body_invalid');
    expect(await refusal({ ...service, portVariable: '1PORT' })).toBe('service_env_invalid');
    expect(await refusal({ ...service, projectId: 'nope' })).toBe('project_not_found');
    expect(await refusal(service, null)).toBe('browser_only');
    const { service: added } = (await (await post('/api/services', service)).json()) as {
      service: ServiceDefinition;
    };
    expect(await refusal({ ...service, name: 'WEB' })).toBe('service_name_taken');
    rmSync(repoPath, { recursive: true });
    const moved = (await (await post(`/api/services/${added.id}/start`, {}, null)).json()) as {
      error: { code: string };
    };
    expect(moved.error.code).toBe('terminal_place_missing');
    const stray = terminals.addService(projectId, {
      name: 'x',
      cwd: '/etc',
      command: 'ls',
      env: {},
      ...NO_PREVIEW,
    });
    const outside = (await (await post(`/api/services/${stray.id}/start`, {}, null)).json()) as {
      error: { code: string };
    };
    expect(outside.error.code).toBe('service_place_invalid');
    expect(resolveServicePlace([], root, root)).toBe('folder');
  });
});

describe('services for a task over HTTP', () => {
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
    expect((await call(service.id, 'start', { taskId })).error?.code).toBe('terminal_place_missing');
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
    const outside = terminals.addService(projectId, {
      name: 'notes',
      cwd: root,
      command: 'ls',
      env: {},
      ...NO_PREVIEW,
    });
    const refused = await call(outside.id, 'start', { taskId });
    expect(refused.error?.code).toBe('service_place_invalid');
    expect(refused.error?.message).toContain('It cannot run in this task.');
    expect(resolveServiceRunIn(engine.state, service, taskId, terminals)?.env).toEqual({});
    writeFiles(worktree, { 'turbo.json': '{}' });
    expect(resolveServiceRunIn(engine.state, service, taskId, terminals)?.env).toEqual({
      TURBO_CACHE_DIR: join(terminals.dataDir, 'caches', repoId, 'turbo'),
    });
  });
});

describe('resolveServicePlace', () => {
  test('runs in a repository or folder of the project, or a folder inside one, never a worktree', () => {
    const places = [
      { path: '/code/web', label: 'web', kind: 'repository', taskId: null },
      { path: '/notes/', label: 'notes', kind: 'folder', taskId: null },
      { path: '/wt/a', label: 'A', kind: 'worktree', taskId: 'a' },
    ] as const;
    expect(resolveServicePlace([...places], '/code/web/apps/api', '/home')).toBe('repository');
    expect(resolveServicePlace([...places], '/notes', '/home')).toBe('folder');
    expect(resolveServicePlace([...places], '/code/website', '/home')).toBeNull();
    expect(resolveServicePlace([...places], '/wt/a', '/home')).toBeNull();
    expect(resolveServicePlace([], '/home/x', '/home')).toBe('folder');
    expect(resolveServicePlace([...places], '/home/x', '/home')).toBeNull();
  });
});

describe('createTerminalSockets', () => {
  test('a socket that drains catches up with the screen, and one without a viewer is skipped', () => {
    const fake = createFakeSpawner();
    const terminals = new Terminals({
      dataDir: createTempDir(),
      home: '/home/ada',
      version: '1',
      spawn: fake.spawn,
      env: {},
    });
    const terminal = terminals.create({ projectId: 'p1', cwd: '/tmp', place: 'folder', taskId: null });
    const sockets = createTerminalSockets(terminals);
    const viewer = createFakeViewer();
    terminals.attach(terminal.id, viewer);
    viewer.bufferedBytes = Number.MAX_SAFE_INTEGER;
    fake.spawned[0]?.emit('x'.repeat(300_000));
    viewer.bufferedBytes = 0;
    const data: TerminalSocketData = { kind: 'terminal', terminalId: terminal.id, viewer };
    const handlers = createSocketHandlers(
      { open: () => undefined, close: () => undefined, message: () => undefined },
      sockets
    );
    handlers.drain({ data } as unknown as Parameters<typeof handlers.drain>[0]);
    handlers.drain({ data: { kind: 'hub' } } as unknown as Parameters<typeof handlers.drain>[0]);
    expect(viewer.controls()).toHaveLength(4);
    sockets.drain({ data: { ...data, viewer: null } } as unknown as Parameters<typeof sockets.drain>[0]);
    expect(viewer.controls()).toHaveLength(4);
  });
});
