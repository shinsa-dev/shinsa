import { describe, expect, setSystemTime, test } from 'bun:test';
import { MINUTE_MS } from '@shinsa/core';
import { createFakeClient, createTaskDetail, runSpec } from './fixtures.ts';

const NOW = Date.UTC(2026, 9, 23, 9, 0);

const MACHINE_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

function schedule(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sch-1',
    name: 'Nightly',
    trigger: { kind: 'interval', everyMinutes: 60 },
    target: { kind: 'new_task', repoId: null, priority: 'normal', mode: 'build' },
    timeZone: 'Europe/Sofia',
    enabled: true,
    stopped: null,
    nextRunAt: null,
    ...overrides,
  };
}

const RESPONSES = {
  '/api/schedules': { schedules: [schedule()] },
  '/api/repos': { repos: [{ id: 'repo-1', name: 'app' }] },
  '/api/tasks/fix': createTaskDetail(),
  '/api/projects': {
    projects: [{ id: 'proj-1', key: 'LOC', name: 'Shinsa', repos: [] }],
    focus: { projectId: null, until: null },
  },
};

async function write(words: string[]) {
  const fake = createFakeClient(RESPONSES);
  setSystemTime(new Date(NOW));
  try {
    const result = await runSpec(fake, ['schedules', 'write', ...words]);
    return { result, command: fake.sent[0] as Record<string, unknown> };
  } finally {
    setSystemTime();
  }
}

describe('listing schedules', () => {
  test('shows each schedule’s state, trigger, target and next run', async () => {
    const fake = createFakeClient({
      '/api/schedules': {
        schedules: [
          schedule({ nextRunAt: NOW }),
          schedule({ id: 'sch-2', name: 'Ping', enabled: false, target: { kind: 'task', taskId: 't' } }),
          schedule({ id: 'sch-3', name: 'Done', stopped: { reason: 'max_runs' }, trigger: { kind: 'once' } }),
        ],
      },
    });
    expect((await runSpec(fake, ['schedules', 'list'])).text.split('\n')).toEqual([
      'sch-1  Nightly  (on) Every hour · Starts a new task · next 2026-10-23T09:00:00.000Z',
      'sch-2  Ping  (paused) Every hour · Messages a task',
      'sch-3  Done  (finished) Once · Starts a new task',
    ]);
    const empty = createFakeClient({ '/api/schedules': { schedules: [] } });
    expect((await runSpec(empty, ['schedules', 'list'])).text).toBe('No schedules.');
  });
});

describe('writing a schedule', () => {
  test('a one-off that starts a new task in a repository, on the machine’s time zone', async () => {
    const { result, command } = await write([
      '--name',
      'Tidy',
      '--message',
      'Tidy the logs',
      '--in-minutes',
      '5',
      '--new-task',
      '--repo',
      'app',
      '--priority',
      'high',
      '--just-answer',
      '--enabled=false',
      '--max-runs',
      '1',
    ]);
    expect(command).toEqual({
      type: 'schedule.write',
      scheduleId: null,
      name: 'Tidy',
      text: 'Tidy the logs',
      trigger: { kind: 'once', at: NOW + 5 * MINUTE_MS },
      target: { kind: 'new_task', repoId: 'repo-1', priority: 'high', mode: 'ask' },
      source: null,
      enabled: false,
      maxRuns: 1,
      timeZone: MACHINE_ZONE,
    });
    expect(result.text).toBe('Created the schedule. `shinsa schedules list` shows it.');
  });

  test('a daily message to a task on chosen weekdays, in a given time zone', async () => {
    const { command } = await write([
      '--daily-at',
      '09:30',
      '--weekdays',
      '1,3',
      '--task',
      'fix',
      '--time-zone',
      'Europe/Berlin',
    ]);
    expect(command).toMatchObject({
      trigger: { kind: 'daily', time: '09:30', weekdays: [1, 3] },
      target: { kind: 'task', taskId: 'task-123' },
      enabled: null,
      maxRuns: null,
      timeZone: 'Europe/Berlin',
    });
  });

  test('a change keeps the schedule’s own time zone, and a new task defaults to normal priority', async () => {
    const { result, command } = await write(['--id', 'sch-1', '--every-minutes', '30', '--new-task']);
    expect(command).toMatchObject({
      scheduleId: 'sch-1',
      name: null,
      text: null,
      trigger: { kind: 'interval', everyMinutes: 30 },
      target: { kind: 'new_task', repoId: null, priority: 'normal', mode: 'build' },
      timeZone: 'Europe/Sofia',
    });
    expect(result.text).toBe('Saved the schedule.');
    const unknown = await write(['--id', 'sch-9', '--every-minutes', '30']);
    expect(unknown.command).toMatchObject({ target: null, timeZone: MACHINE_ZONE });
  });

  test('a webhook with a signature check and a replay key', async () => {
    const { command } = await write([
      '--webhook',
      '--signature-header',
      'X-Hub-Signature-256',
      '--signature-encoding',
      'base64',
      '--signature-prefix',
      'sha256=',
      '--replay-key',
      '{{body.id}}',
      '--new-task',
    ]);
    expect(command.trigger).toMatchObject({
      kind: 'webhook',
      signature: { header: 'x-hub-signature-256', encoding: 'base64', prefix: 'sha256=' },
      replayKey: '{{body.id}}',
    });
    const plain = await write(['--webhook', '--new-task']);
    expect(plain.command.trigger).toMatchObject({ kind: 'webhook', signature: null });
  });

  test('a trigger core refuses, or both targets at once, is refused before anything is sent', async () => {
    await expect(write(['--every-minutes', '0'])).rejects.toMatchObject({ code: 'schedule_invalid' });
    await expect(write(['--in-minutes', '5', '--task', 'fix', '--new-task'])).rejects.toThrow(
      'Give --new-task or --task, not both.'
    );
  });

  test('reading a data source names the project’s source, with or without a task to read it in', async () => {
    const { command } = await write(['--every-minutes', '60', '--source', 'slack', '--project', 'LOC']);
    expect(command).toMatchObject({ target: null, source: { projectId: 'proj-1', server: 'slack' } });
    const inTask = await write([
      '--every-minutes',
      '60',
      '--source',
      'slack',
      '--project',
      'Shinsa',
      '--task',
      'fix',
    ]);
    expect(inTask.command).toMatchObject({
      target: { kind: 'task', taskId: 'task-123' },
      source: { projectId: 'proj-1', server: 'slack' },
    });
    const plain = await write(['--every-minutes', '60', '--task', 'fix']);
    expect(plain.command).toMatchObject({ source: null });
  });

  test('a data source needs its project, and a project is only for a data source', async () => {
    await expect(write(['--every-minutes', '60', '--source', 'slack'])).rejects.toThrow(
      'Name the project whose data source it reads with --project.'
    );
    await expect(write(['--every-minutes', '60', '--project', 'LOC'])).rejects.toThrow(
      'Give --project only with --source.'
    );
    await expect(
      write(['--every-minutes', '60', '--source', 'slack', '--project', 'nope'])
    ).rejects.toMatchObject({
      code: 'project_not_found',
    });
  });
});

describe('switching schedules on and off', () => {
  test('enable, disable and delete send the schedule commands', async () => {
    const fake = createFakeClient();
    expect((await runSpec(fake, ['schedules', 'enable', 'sch-1'])).text).toBe('Resumed.');
    expect((await runSpec(fake, ['schedules', 'disable', 'sch-1'])).text).toBe('Paused.');
    expect((await runSpec(fake, ['schedules', 'delete', 'sch-1'])).text).toBe('Deleted.');
    expect(fake.sent).toEqual([
      { type: 'schedule.enable', scheduleId: 'sch-1', enabled: true },
      { type: 'schedule.enable', scheduleId: 'sch-1', enabled: false },
      { type: 'schedule.remove', scheduleId: 'sch-1' },
    ]);
  });
});

describe('webhooks', () => {
  test('shows the URL and its signature check, with or without a prefix and a secret', async () => {
    const hook = (signature: unknown, hasSecret: boolean) => ({
      url: 'http://127.0.0.1:5180/api/hooks/sch-1/tok',
      signature,
      hasSecret,
      replayKey: null,
    });
    const fake = createFakeClient({
      '/api/schedules/sch-1/webhook': hook({ header: 'X-Sig', encoding: 'hex', prefix: 'sha256=' }, true),
      '/api/schedules/sch-2/webhook': hook({ header: 'X-Sig', encoding: 'base64', prefix: '' }, false),
      '/api/schedules/sch-3/webhook': hook(null, false),
    });
    expect((await runSpec(fake, ['schedules', 'webhook', 'sch-1'])).text).toBe(
      'http://127.0.0.1:5180/api/hooks/sch-1/tok\nSignature: X-Sig (hex, prefix sha256=), secret set'
    );
    expect((await runSpec(fake, ['schedules', 'webhook', 'sch-2'])).text).toContain(
      'Signature: X-Sig (base64), secret missing'
    );
    expect((await runSpec(fake, ['schedules', 'webhook', 'sch-3'])).text).toContain('No signature check.');
  });

  test('the signing secret is posted to the schedule’s webhook', async () => {
    const fake = createFakeClient({ '/api/schedules/sch-1/webhook': { ok: true } });
    expect((await runSpec(fake, ['schedules', 'webhook-secret', 'sch-1', 'shh'])).text).toBe(
      'Saved the signing secret.'
    );
    expect(fake.posts).toEqual([{ path: '/api/schedules/sch-1/webhook', body: { secret: 'shh' } }]);
  });
});
