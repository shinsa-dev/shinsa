import { describe, expect, test } from 'bun:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ShinsaState, Task } from '@shinsa/core';
import { handleServiceTool, SERVICE_OUTPUT_LINES, type ServiceToolName } from '../../src/agents/services.ts';
import { Terminals } from '../../src/terminals/index.ts';
import { createTempDir, until } from '../helpers/index.ts';
import { createRepo, createTask } from '../helpers/state.ts';
import { createFakeSpawner } from '../terminals/fakes.ts';

const NO_PREVIEW = { previewUrl: null, portVariable: 'PORT' };

function setup(options: { services?: boolean; worktree?: boolean } = {}) {
  const root = createTempDir();
  const repoPath = join(root, 'app');
  const worktree = join(root, 'wt');
  mkdirSync(join(repoPath, 'apps/api'), { recursive: true });
  if (options.worktree ?? true) mkdirSync(join(worktree, 'apps/api'), { recursive: true });
  const task = createTask({ worktreePath: worktree });
  const other = createTask({ id: 'task-2', handle: 'APP-2', worktreePath: join(root, 'wt-2') });
  const state = {
    repos: { 'repo-1': createRepo({ path: repoPath, projectId: 'p1' }) },
    projects: { p1: { id: 'p1', name: 'App', key: 'APP', folders: [root] } },
    tasks: { 'task-1': task, 'task-2': other },
  } as unknown as ShinsaState;
  const fake = createFakeSpawner();
  let id = 0;
  const runner = new Terminals({
    dataDir: createTempDir(),
    home: root,
    version: '1.0.0',
    env: { SHELL: '/bin/sh', PATH: '/bin' },
    spawn: fake.spawn,
    now: () => 100_000,
    newId: () => `id-${++id}`,
    pickPort: () => 6100,
    notifyMs: 1,
  });
  if (options.services ?? true) {
    runner.addService('p1', {
      name: 'api',
      cwd: join(repoPath, 'apps/api'),
      command: 'bun dev',
      env: {},
      ...NO_PREVIEW,
    });
    runner.addService('p1', { name: 'notes', cwd: root, command: 'ls', env: {}, ...NO_PREVIEW });
  }
  const call = (name: ServiceToolName, input: Record<string, unknown> = {}, on: Task = task) =>
    handleServiceTool(name, input, { state, task: on, runner, now: 200_000 });
  return { call, runner, fake, worktree, repoPath, root, other };
}

describe('the service tools', () => {
  test('lists the services the task can run, each in the worktree, then the project’s others', async () => {
    const { call, worktree, root } = setup();
    expect(await call('list_services')).toBe(
      [
        'The project’s services, as they run for this task:',
        `- api (stopped): \`bun dev\` in ${join(worktree, 'apps/api')}`,
        'Its other services, which cannot run for this task:',
        `- notes: \`ls\` in ${root}`,
      ].join('\n')
    );
  });

  test('says why there is nothing to run', async () => {
    expect(await setup({ services: false }).call('list_services')).toBe(
      'The project has no services. Add the one you need with add_service.'
    );
    const { call, other } = setup();
    const listed = await call('list_services', {}, { ...other, worktreePath: null });
    expect(listed).toStartWith('None of the project’s services can run for this task');
    expect(listed).toContain('- api: `bun dev`');
  });

  test('starts, reads, restarts and stops the task’s own run, never the main one or another task’s', async () => {
    const { call, runner, fake, worktree, repoPath, other } = setup();
    runner.startService('id-1', { cwd: join(repoPath, 'apps/api'), place: 'repository', taskId: null });
    expect(await call('run_service', { service: 'API', action: 'start' })).toBe(
      `Started api for this task in ${join(worktree, 'apps/api')}. Read its output with list_services and the service’s name.`
    );
    expect(await call('run_service', { service: 'api', action: 'start' })).toBe(
      `api already runs for this task in ${join(worktree, 'apps/api')}.`
    );
    expect(await call('list_services', { service: 'api' })).toEndWith('No output yet.');
    fake.spawned[1]?.emit('ready on :5173\r\n');
    await until('the output', async () => (await runner.readServiceOutput('id-1', 'task-1', 5)).length > 0);
    expect(await call('list_services', { service: 'id-1' })).toEndWith(
      'Its last 1 lines:\n```text\nready on :5173\n```'
    );
    expect(await call('run_service', { service: 'api', action: 'restart' })).toStartWith('Restarted api');
    expect(await call('run_service', { service: 'api', action: 'stop' })).toBe('Stopped api for this task.');
    expect(await call('list_services', {}, other)).toContain('api (stopped)');
    expect(runner.snapshot().terminals.map((each) => [each.taskId, each.status])).toEqual([
      [null, 'running'],
      ['task-1', 'stopped'],
    ]);
    expect(fake.spawned.map((each) => each.hungUp)).toEqual([false, true, true]);
    expect(await call('list_services')).toContain('api (stopped)');
    expect(SERVICE_OUTPUT_LINES).toBe(60);
  });

  test('gives the preview URL of a run that has one, while it runs', async () => {
    const { call, runner, worktree } = setup();
    runner.updateService('id-1', {
      ...runner.findService('id-1'),
      previewUrl: 'http://localhost:{port}/tasks/SW-17',
    });
    const preview = 'http://localhost:6100/tasks/SW-17';
    expect(await call('run_service', { service: 'api', action: 'start' })).toBe(
      `Started api for this task in ${join(worktree, 'apps/api')}. Its preview is at ${preview} once it is up. Read its output with list_services and the service’s name.`
    );
    expect(await call('run_service', { service: 'api', action: 'start' })).toBe(
      `api already runs for this task in ${join(worktree, 'apps/api')}, preview at ${preview}.`
    );
    expect(await call('list_services')).toContain(`, preview at ${preview}`);
    await call('run_service', { service: 'api', action: 'stop' });
    expect(await call('list_services')).not.toContain('preview at');
  });

  test('shows a failed run with its exit code', async () => {
    const { call, fake } = setup();
    await call('run_service', { service: 'api', action: 'start' });
    fake.spawned[0]?.exit(1);
    await until('it fails', async () => (await call('list_services')).includes('failed'));
    expect(await call('list_services')).toContain('api (failed with code 1)');
  });

  test('refuses an unknown service or action and a worktree without the folder', async () => {
    const { call } = setup();
    expect(call('run_service', { service: 'web', action: 'start' })).rejects.toThrow(
      'No service web for this task. Call list_services to see them.'
    );
    expect(call('list_services', { service: 'web' })).rejects.toThrow('No service web for this task.');
    expect(call('run_service', { service: 'api', action: 'launch' })).rejects.toThrow(
      'action must be start, stop or restart.'
    );
    expect(call('run_service', { action: 'start' })).rejects.toThrow('service is required.');
    const missing = setup({ worktree: false });
    expect(missing.call('run_service', { service: 'api', action: 'start' })).rejects.toThrow(
      'is not in the worktree.'
    );
  });

  test('refuses a run the task has lost since it listed the service', async () => {
    const { call, other } = setup();
    expect(
      call(
        'run_service',
        { service: 'api', action: 'start' },
        { ...other, id: 'gone', worktreePath: '/nowhere' }
      )
    ).rejects.toThrow('api cannot run for this task.');
  });

  test('adds a service in the repository’s own checkout, which the task can then run', async () => {
    const { call, runner, repoPath, worktree } = setup({ services: false });
    expect(
      await call('add_service', {
        name: 'api',
        path: './apps/api/',
        command: ' bun run dev ',
        preview_url: 'http://localhost:{port}',
        port_variable: 'API_PORT',
        env: { NODE_ENV: 'development' },
      })
    ).toBe(
      'Added api to the project: `bun run dev` in `apps/api`. The human sees it under Services. Start it for this task with run_service.'
    );
    expect(runner.snapshot().services).toEqual([
      {
        id: 'id-1',
        projectId: 'p1',
        name: 'api',
        cwd: join(repoPath, 'apps/api'),
        command: 'bun run dev',
        env: { NODE_ENV: 'development' },
        previewUrl: 'http://localhost:{port}',
        portVariable: 'API_PORT',
      },
    ]);
    expect(await call('list_services')).toBe(
      [
        'The project’s services, as they run for this task:',
        `- api (stopped): \`bun run dev\` in ${join(worktree, 'apps/api')}`,
      ].join('\n')
    );
    expect(await call('add_service', { name: 'all', command: 'bun dev', env: null })).toStartWith(
      'Added all to the project: `bun dev` in the repository’s root.'
    );
    expect(runner.findService('id-2')).toMatchObject({ cwd: repoPath, env: {}, portVariable: 'PORT' });
  });

  test('refuses a folder outside the repository or not in its checkout, and what the Services form refuses', async () => {
    const { call } = setup();
    expect(call('add_service', { name: 'web', path: '../other', command: 'x' })).rejects.toThrow(
      'path must be a folder inside this task’s repository'
    );
    expect(call('add_service', { name: 'web', path: '/etc', command: 'x' })).rejects.toThrow(
      'path must be a folder inside this task’s repository'
    );
    expect(call('add_service', { name: 'web', path: 'apps/web', command: 'x' })).rejects.toThrow(
      '`apps/web` is not in the repository’s own checkout yet.'
    );
    expect(call('add_service', { name: 'API', path: 'apps/api', command: 'x' })).rejects.toThrow(
      'Another service has that name.'
    );
    expect(
      call('add_service', { name: 'web', command: 'x', preview_url: 'http://localhost:3000' })
    ).rejects.toThrow('Put {port} in an http or https URL.');
    expect(call('add_service', { name: 'web' })).rejects.toThrow('Send “command” as text');
  });

  test('refuses a task outside a project’s repository', async () => {
    const { call, other } = setup();
    expect(call('add_service', { name: 'web', command: 'x' }, { ...other, repoId: null })).rejects.toThrow(
      'add_service needs a task that works in a project’s repository.'
    );
  });

  test('removes services by name or id, the task’s own runs with them, outside the repository too', async () => {
    const { call, runner, fake } = setup();
    await call('run_service', { service: 'api', action: 'start' });
    expect(await call('remove_service', { services: [' API ', 'id-2', 'api'] })).toBe(
      'Removed api, notes from the project. The human no longer sees them under Services.'
    );
    expect(runner.snapshot()).toMatchObject({ services: [], terminals: [] });
    expect(fake.spawned[0]?.hungUp).toBe(true);
  });

  test('removes a service whose other runs have stopped', async () => {
    const { call, runner, repoPath } = setup();
    runner.startService('id-1', { cwd: join(repoPath, 'apps/api'), place: 'repository', taskId: null });
    await runner.stopService('id-1', null);
    expect(await call('remove_service', { services: ['api'] })).toStartWith('Removed api');
  });

  test('refuses a service that runs for the human or another task, and removes nothing', async () => {
    const { call, runner, repoPath, root, other } = setup();
    mkdirSync(join(root, 'wt-2/apps/api'), { recursive: true });
    runner.startService('id-1', { cwd: join(repoPath, 'apps/api'), place: 'repository', taskId: null });
    await call('run_service', { service: 'api', action: 'start' }, other);
    expect(call('remove_service', { services: ['notes', 'api'] })).rejects.toThrow(
      'Nothing was removed: api runs for the human and task APP-2. Leave it, or ask the human to stop that run first.'
    );
    await runner.stopService('id-1', null);
    expect(call('remove_service', { services: ['api'] }, { ...other, id: 'task-3' })).rejects.toThrow(
      'api runs for task APP-2.'
    );
    const gone = createTask({ id: 'task-9', worktreePath: '/nowhere' });
    runner.startService('id-2', { cwd: repoPath, place: 'repository', taskId: gone.id });
    expect(call('remove_service', { services: ['notes'] })).rejects.toThrow('notes runs for task task-9.');
    expect(runner.snapshot().services.map((each) => each.name)).toEqual(['api', 'notes']);
  });

  test('refuses an unknown service before removing any, a bad list and a task outside a project', async () => {
    const { call, runner, other } = setup();
    expect(call('remove_service', { services: ['api', 'web'] })).rejects.toThrow(
      'No service web in the project. Call list_services to see them.'
    );
    expect(runner.snapshot().services).toHaveLength(2);
    for (const services of [undefined, [], 'api', [3]])
      expect(call('remove_service', { services })).rejects.toThrow(
        'services must be a list of the services’ names.'
      );
    expect(
      call('remove_service', { services: ['api'] }, { ...other, repoId: null, projectId: null })
    ).rejects.toThrow('remove_service needs a task in a project.');
  });
});
