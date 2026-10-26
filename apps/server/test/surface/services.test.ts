import { describe, expect, test } from 'bun:test';
import { SERVICE_LIMITS } from '@shinsa/core';
import { COLOR_DISPLAY, createFakeClient, runSpec } from './fixtures.ts';

function service(id: string, projectId: string, name = id) {
  return { id, projectId, name, cwd: `/code/${id}`, command: 'bun run dev', env: {} };
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
  terminals: [terminal('api'), terminal('web', { status: 'exited', exitCode: 1, endedAt: 1 })],
  services: [service('api', 'p1'), service('web', 'p1'), service('blog-web', 'p2', 'web')],
  home: '/home',
};

function createClient() {
  return createFakeClient({
    '/api/terminals': SNAPSHOT,
    '/api/projects': PROJECTS,
    '/api/services/api/start': SNAPSHOT,
    '/api/services/api/stop': SNAPSHOT,
    '/api/services/blog-web/restart': SNAPSHOT,
  });
}

describe('services', () => {
  test('lists each service with its project, state and command', async () => {
    const lines = (await runSpec(createClient(), ['services', 'list'])).text.split('\n');
    expect(lines[0]).toMatch(/^Service\s+Project\s+State\s+Command$/);
    expect(lines.slice(1).map((line) => line.split(/\s{2,}/).slice(0, 3))).toEqual([
      ['api', 'Shop', 'running'],
      ['web', 'Shop', 'failed (code 1)'],
      ['web', 'Blog', 'stopped'],
    ]);
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

  test('asks for the project when two have a service by that name, and names a missing one', async () => {
    await expect(runSpec(createClient(), ['services', 'start', 'web'])).rejects.toThrow('--project');
    await expect(runSpec(createClient(), ['services', 'start', 'docs'])).rejects.toThrow('No service docs.');
  });
});
