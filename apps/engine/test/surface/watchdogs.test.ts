import { describe, expect, test } from 'bun:test';
import { createFakeClient, createTaskDetail, runSpec } from './fixtures.ts';

const WATCHED = createTaskDetail({
  watchdogs: [
    { id: 'w-1', title: 'Checkout latency', status: 'watching' },
    { id: 'w-2', title: 'Paywall events', status: 'needs_source' },
  ],
});

const PROJECTS = {
  projects: [
    {
      id: 'project-1',
      name: 'Work',
      color: 'blue',
      key: 'WK',
      description: '',
      folders: [],
      repos: [{ id: 'repo-1', name: 'app', path: '/code/app' }],
      watchSources: [
        { server: 'maple', data: 'Traces', repoIds: [], addedBy: 'you', addedAt: 0 },
        { server: 'slack', data: 'Support', repoIds: ['repo-1', 'repo-gone'], addedBy: 'agent', addedAt: 0 },
      ],
    },
    { id: 'project-2', name: 'Home', color: 'green', key: 'HOME', description: '', folders: [], repos: [] },
  ],
  focus: { projectId: null, until: null },
};

function createClient(detail = WATCHED) {
  return createFakeClient({
    '/api/tasks/fix': detail,
    '/api/projects': PROJECTS,
    '/api/repos': { repos: [{ id: 'repo-1', name: 'app' }] },
  });
}

describe('watchdogs on the command line', () => {
  test('stops one by number or title, and connects a source to one waiting for it', async () => {
    const fake = createClient();
    expect((await runSpec(fake, ['watchdogs', 'stop', 'fix', '1'])).text).toBe('Stopped the watchdog.');
    await runSpec(fake, ['watchdogs', 'stop', 'fix', 'checkout latency']);
    expect(
      (
        await runSpec(fake, [
          'watchdogs',
          'connect',
          'fix',
          'Paywall events',
          '--server',
          'posthog',
          '--data',
          'Events',
        ])
      ).text
    ).toBe('Connected the source; the watchdog starts watching.');
    expect(fake.sent).toEqual([
      { type: 'watchdog.stop', taskId: 'task-123', watchdogId: 'w-1' },
      { type: 'watchdog.stop', taskId: 'task-123', watchdogId: 'w-1' },
      { type: 'watchdog.connect', taskId: 'task-123', watchdogId: 'w-2', server: 'posthog', data: 'Events' },
    ]);
  });

  test('names what is missing: a watchdog it does not know, or a task without any', async () => {
    await expect(runSpec(createClient(), ['watchdogs', 'stop', 'fix', '9'])).rejects.toThrow(
      '“Fix the tab scroll” has no watchdog 9. `shinsa tasks show` lists them, numbered from 1.'
    );
    await expect(
      runSpec(createClient(createTaskDetail({ watchdogs: [] })), ['watchdogs', 'stop', 'fix', '1'])
    ).rejects.toThrow('“Fix the tab scroll” has no watchdogs.');
  });
});

describe('a project’s data sources on the command line', () => {
  test('lists them with the repositories they cover, and says when there are none', async () => {
    const fake = createClient();
    expect((await runSpec(fake, ['sources', 'list', 'WK'])).text).toBe(
      'maple: Traces (every repository)\nslack: Support (app, repo-gone)'
    );
    expect((await runSpec(fake, ['sources', 'list', 'home'])).text).toBe('Home has no data sources yet.');
    expect((await runSpec(fake, ['sources', 'list', 'nope'])).text).toBe('No project nope.');
  });

  test('writes one for some repositories or every one, and removes one', async () => {
    const fake = createClient();
    expect(
      (
        await runSpec(fake, [
          'sources',
          'write',
          'WK',
          '--server',
          'maple',
          '--data',
          'Logs',
          '--repos',
          'app',
        ])
      ).text
    ).toBe('Saved the data source.');
    await runSpec(fake, ['sources', 'write', 'WK', '--server', 'sentry', '--data', 'Errors']);
    expect((await runSpec(fake, ['sources', 'remove', 'WK', '--server', 'maple'])).text).toBe(
      'Removed the data source.'
    );
    expect(fake.sent).toEqual([
      {
        type: 'watch_source.write',
        projectId: 'project-1',
        server: 'maple',
        data: 'Logs',
        repoIds: ['repo-1'],
      },
      { type: 'watch_source.write', projectId: 'project-1', server: 'sentry', data: 'Errors', repoIds: [] },
      { type: 'watch_source.remove', projectId: 'project-1', server: 'maple' },
    ]);
  });
});
