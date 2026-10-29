import { describe, expect, test } from 'bun:test';
import { SERVICE_LIMITS } from '@shinsa/core';
import { COLOR_DISPLAY, createFakeClient, runSpec } from './fixtures.ts';

function service(id: string, projectId: string, name = id, previewUrl: string | null = null) {
  return {
    id,
    projectId,
    name,
    cwd: `/code/${id}`,
    command: 'bun run dev',
    env: {},
    previewUrl,
    portVariable: 'PORT',
  };
}

function terminal(serviceId: string, extra: Record<string, unknown> = {}) {
  return {
    id: `t-${serviceId}`,
    projectId: 'p1',
    name: serviceId,
    title: null,
    cwd: '/code',
    place: 'repository',
    taskId: null,
    serviceId,
    port: 4100,
    status: 'running',
    exitCode: null,
    startedAt: Date.now() - SERVICE_LIMITS.startingMs - 1000,
    endedAt: null,
    ...extra,
  };
}

const PROJECTS = {
  projects: [
    { id: 'p1', key: 'SH', name: 'Shop' },
    { id: 'p2', key: 'BL', name: 'Blog' },
  ],
};

const SNAPSHOT = {
  terminals: [
    terminal('api'),
    terminal('web', { status: 'exited', exitCode: 1, endedAt: 1 }),
    terminal('api', { id: 't-api-a', taskId: 'task-a' }),
    terminal('api', { id: 't-api-b', taskId: 'task-b' }),
    terminal('web', { id: 't-web-a', taskId: 'task-a', status: 'stopped', endedAt: 1 }),
  ],
  services: [
    service('api', 'p1', 'api', 'http://localhost:{port}/'),
    service('web', 'p1', 'web', 'http://localhost:{port}/'),
    service('blog-web', 'p2', 'web'),
  ],
  home: '/home',
};

function createClient() {
  return createFakeClient({
    '/api/terminals': SNAPSHOT,
    '/api/projects': PROJECTS,
    '/api/services/api/start': SNAPSHOT,
    '/api/services/api/stop': SNAPSHOT,
    '/api/services/blog-web/restart': SNAPSHOT,
    '/api/tasks/SH-4': { task: { id: 'task-a' } },
  });
}

describe('services', () => {
  test('lists each service with its project, state, its runs for tasks, preview and command', async () => {
    const lines = (await runSpec(createClient(), ['services', 'list'])).text.split('\n');
    expect(lines[0]).toMatch(/^Service\s+Project\s+State\s+Tasks\s+Preview\s+Command$/);
    expect(lines.slice(1).map((line) => line.split(/\s{2,}/).slice(0, 4))).toEqual([
      ['api', 'Shop', 'running', '2 running'],
      ['web', 'Shop', 'failed (code 1)', 'bun run dev'],
      ['web', 'Blog', 'stopped', 'bun run dev'],
    ]);
    expect(lines[1]).toContain('http://localhost:4100/');
    expect(lines[2]).not.toContain('http://localhost');
    const blog = await runSpec(createClient(), ['services', 'list', '--project', 'BL'], COLOR_DISPLAY);
    expect(blog.text.split('\n')).toHaveLength(2);
    const empty = createFakeClient({
      '/api/terminals': { ...SNAPSHOT, services: [] },
      '/api/projects': PROJECTS,
    });
    expect((await runSpec(empty, ['services', 'list'])).text).toBe(
      'No services. Add one from Services at the top of Shinsa.'
    );
    await expect(runSpec(createClient(), ['services', 'list', '--project', 'nope'])).rejects.toThrow(
      'No project nope.'
    );
  });

  test('starts, stops and restarts a service by its name', async () => {
    const fake = createClient();
    expect((await runSpec(fake, ['services', 'start', 'API'])).text).toBe('Started api.');
    expect((await runSpec(fake, ['services', 'stop', 'api', '--project', 'Shop'])).text).toBe('Stopped api.');
    expect((await runSpec(fake, ['services', 'restart', 'web', '--project', 'BL'])).text).toBe(
      'Restarted web.'
    );
    expect(fake.posts.map((post) => post.path)).toEqual([
      '/api/services/api/start',
      '/api/services/api/stop',
      '/api/services/blog-web/restart',
    ]);
  });

  test('runs a service for a task with --task', async () => {
    const fake = createClient();
    expect((await runSpec(fake, ['services', 'start', 'api', '--task', 'SH-4'])).text).toBe(
      'Started api for SH-4.'
    );
    expect((await runSpec(fake, ['services', 'stop', 'api', '--task', 'SH-4'])).text).toBe(
      'Stopped api for SH-4.'
    );
    expect(fake.posts.map((post) => post.body)).toEqual([{ taskId: 'task-a' }, { taskId: 'task-a' }]);
  });

  test('asks for the project when two have a service by that name, and names a missing one', async () => {
    await expect(runSpec(createClient(), ['services', 'start', 'web'])).rejects.toThrow('--project');
    await expect(runSpec(createClient(), ['services', 'start', 'docs'])).rejects.toThrow('No service docs.');
  });
});
