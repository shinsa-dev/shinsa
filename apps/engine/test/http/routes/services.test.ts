import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ServiceDefinition, ServiceSuggestion, TerminalInfo, TerminalsSnapshot } from '@shinsa/core';
import { Effect, Option } from 'effect';
import { resolveServicePlace } from '../../../src/terminals/places.ts';
import { selectServiceRunIn } from '../../../src/terminals/runs.ts';
import { runFiles } from '../../harness.ts';
import { until, writeFiles } from '../../helpers/index.ts';
import {
  attachTerminal as attach,
  createTestRefiner,
  NO_PREVIEW,
  ORIGIN,
  startTerminalServer as start,
  stopTerminalServers,
} from '../../helpers/terminals.ts';
import { runAsync } from '../../terminals/harness.ts';

setDefaultTimeout(30_000);

afterEach(stopTerminalServers);

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
    const refiner = createTestRefiner(<T>() => Effect.succeed((answers.shift() ?? null) as T | null));
    const { read, projectId, repoPath, terminals } = await start({ refiner });
    for (const app of ['api', 'site']) {
      mkdirSync(join(repoPath, `apps/${app}`), { recursive: true });
      writeFileSync(join(repoPath, `apps/${app}/package.json`), JSON.stringify({ scripts: { dev: 'x' } }));
    }
    writeFileSync(join(repoPath, 'package.json'), JSON.stringify({ workspaces: ['apps/*'] }));
    await runAsync(
      terminals.addService(projectId, {
        name: 'gateway',
        cwd: repoPath,
        command: 'x',
        env: {},
        ...NO_PREVIEW,
      })
    );
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
    await runAsync(
      terminals.addService(projectId, {
        name: 'gateway',
        cwd: join(repoPath, 'apps/api'),
        command: 'npm run dev',
        env: {},
        ...NO_PREVIEW,
      })
    );
    await runAsync(
      terminals.updateService(service.id, {
        name: 'renamed',
        cwd: service.cwd,
        command: service.command,
        env: service.env,
        previewUrl: service.previewUrl,
        portVariable: service.portVariable,
      })
    );
    const same = await read<{ suggestions: ServiceSuggestion[] }>(
      `/api/services/suggestions?projectId=${projectId}`
    );
    expect(same.suggestions).toEqual([]);
    for (const each of (await runAsync(terminals.snapshot)).services)
      if (each.id !== service.id) await runAsync(terminals.removeServices([each.id]));

    const started = (await (await post(`/api/services/${service.id}/start`, {}, null)).json()) as {
      terminal: TerminalInfo;
    };
    expect(started.terminal).toMatchObject({ serviceId: service.id, status: 'running', port: 4100 });
    await until('it printed', async () =>
      (await runAsync((await runAsync(terminals.find(started.terminal.id))).serializeScreen)).includes(
        'up-4100'
      )
    );
    await post(`/api/services/${service.id}/stop`, {}, null);
    expect((await runAsync(terminals.find(started.terminal.id))).info.status).toBe('stopped');
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
    await until(
      'it failed',
      async () => (await runAsync(terminals.find(started.terminal.id))).info.exitCode === 4
    );
    const failedAt = (await runAsync(terminals.find(started.terminal.id))).info.startedAt;
    await post('/api/services/start-all', { projectId }, null);
    expect((await runAsync(terminals.find(started.terminal.id))).info.startedAt).toBeGreaterThan(failedAt);

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
    expect((await runAsync(terminals.snapshot)).services).toEqual([]);
    for (let index = 0; index < 31; index += 1)
      await runAsync(
        terminals.addService(projectId, {
          name: `s${index}`,
          cwd: repoPath,
          command: 'x',
          env: {},
          ...NO_PREVIEW,
        })
      );
    const limited = (await (
      await post('/api/services/batch', { projectId, services: [one, { ...one, name: 'web' }] })
    ).json()) as { error: { code: string; message: string } };
    const names = Array.from({ length: 31 }, (_, index) => `s${index}`);
    expect(limited.error).toEqual({
      code: 'service_limit',
      message: `This project keeps 32 services at most, and has 31: ${new Intl.ListFormat('en').format(names)}. Remove one under Services to add these 2.`,
    });
    for (const service of (await runAsync(terminals.snapshot)).services)
      await runAsync(terminals.removeServices([service.id]));
    for (let index = 0; index < 32; index += 1)
      await runAsync(
        terminals.addService('elsewhere', {
          name: `s${index}`,
          cwd: repoPath,
          command: 'x',
          env: {},
          ...NO_PREVIEW,
        })
      );
    const added = (await (
      await post('/api/services/batch', { projectId, services: [one, { ...one, name: 'web' }] })
    ).json()) as { added: ServiceDefinition[] } & TerminalsSnapshot;
    expect(added.added.map((service) => service.name)).toEqual(['api', 'web']);
    expect(
      added.services.filter((service) => service.projectId === projectId).map((service) => service.name)
    ).toEqual(['api', 'web']);
  });

  test('removes several services at once, finding every one before it removes any', async () => {
    const { post, projectId, repoPath, terminals } = await start();
    const add = (name: string) =>
      runAsync(
        terminals.addService(projectId, { name, cwd: repoPath, command: 'sleep 30', env: {}, ...NO_PREVIEW })
      );
    const api = await add('api');
    const web = await add('web');
    const docs = await add('docs');
    const started = await runAsync(
      terminals.startService(api.id, { cwd: repoPath, place: 'repository', taskId: null })
    );
    const refusal = async (body: unknown, origin: string | null = ORIGIN) =>
      ((await (await post('/api/services/remove', body, origin)).json()) as { error: { code: string } }).error
        .code;
    expect(await refusal({ ids: [] })).toBe('body_invalid');
    expect(await refusal({ ids: 'api' })).toBe('body_invalid');
    expect(await refusal({ ids: [api.id, 3] })).toBe('body_invalid');
    expect(await refusal({ ids: [api.id, 'gone'] })).toBe('service_not_found');
    expect(await refusal({ ids: [api.id] }, null)).toBe('browser_only');
    expect((await runAsync(terminals.snapshot)).services).toHaveLength(3);
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
    const stray = await runAsync(
      terminals.addService(projectId, {
        name: 'x',
        cwd: '/etc',
        command: 'ls',
        env: {},
        ...NO_PREVIEW,
      })
    );
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
    const service = await runAsync(
      terminals.addService(projectId, {
        name: 'api',
        cwd: appPath,
        command: 'sleep 30',
        env: {},
        ...NO_PREVIEW,
      })
    );
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
    const outside = await runAsync(
      terminals.addService(projectId, {
        name: 'notes',
        cwd: root,
        command: 'ls',
        env: {},
        ...NO_PREVIEW,
      })
    );
    const refused = await call(outside.id, 'start', { taskId });
    expect(refused.error?.code).toBe('service_place_invalid');
    expect(refused.error?.message).toContain('It cannot run in this task.');
    const envOf = async () =>
      Option.getOrNull(await runFiles(selectServiceRunIn(engine.state, service, taskId, terminals)))?.env;
    expect(await envOf()).toEqual({});
    writeFiles(worktree, { 'turbo.json': '{}' });
    expect(await envOf()).toEqual({
      TURBO_CACHE_DIR: join(terminals.dataDir, 'caches', repoId, 'turbo'),
    });
  });
});
