import { describe, expect, test } from 'bun:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ShinsaState, Task } from '@shinsa/core';
import { handleServiceTool, SERVICE_OUTPUT_LINES } from '../../src/agents/services.ts';
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
  const other = createTask({ id: 'task-2', worktreePath: join(root, 'wt-2') });
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
  const call = (
    name: 'list_services' | 'run_service',
    input: Record<string, unknown> = {},
    on: Task = task
  ) => handleServiceTool(name, input, { state, task: on, runner, now: 200_000 });
  return { call, runner, fake, worktree, repoPath, other };
}

describe('the service tools', () => {
  test('lists the services the task can run, each in the worktree', async () => {
    const { call, worktree } = setup();
    expect(await call('list_services')).toBe(
      [
        'The project’s services, as they run for this task:',
        `- api (stopped): \`bun dev\` in ${join(worktree, 'apps/api')}`,
      ].join('\n')
    );
  });

  test('says why there is nothing to run', async () => {
    expect(await setup({ services: false }).call('list_services')).toBe(
      'The project has no services. The human adds them in Shinsa under Services.'
    );
    const { call, other } = setup();
    expect(await call('list_services', {}, { ...other, worktreePath: null })).toStartWith(
      'None of the project’s services can run for this task'
    );
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
});
