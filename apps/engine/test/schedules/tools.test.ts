import { afterEach, describe, expect, test } from 'bun:test';
import { listActiveRuns, type ShinsaCommand, type ShinsaEvent } from '@shinsa/core';
import { Effect } from 'effect';
import { createManageClient } from '../../src/agents/manage/client.ts';
import { Schedules } from '../../src/schedules/index.ts';
import { findHookUrl } from '../../src/schedules/tools.ts';
import { readArgv, selectSpec } from '../../src/surface/index.ts';
import { createWorld, startTask, type World } from './fixtures.ts';

const NOW = Date.now();

const started: Schedules[] = [];

afterEach(() => {
  for (const schedules of started.splice(0)) schedules.stop();
});

function setUp(world: World) {
  const schedules = new Schedules(world.engine, world.secrets, {
    baseUrl: () => 'http://127.0.0.1:5180',
    timeZone: 'Europe/Berlin',
    now: () => NOW,
  });
  schedules.start();
  started.push(schedules);
  const call = {
    runId: world.runId,
    attemptId: 'a1',
    state: () => world.engine.state,
    dispatch: (command: Parameters<typeof world.engine.dispatch>[0]) => world.engine.dispatch(command),
  };
  const tool = (name: string, input: Record<string, unknown> = {}) => {
    const reply = schedules.handleTool(name, input, call);
    if (!reply) throw new Error(`${name} is not a schedule tool`);
    return reply;
  };
  return { schedules, call, tool };
}

function only(world: World) {
  const [schedule] = Object.values(world.engine.state.schedules);
  if (!schedule) throw new Error('no schedule');
  return schedule;
}

describe('set_schedule', () => {
  test('saves a daily schedule in the machine’s time zone and says when it runs next', async () => {
    const world = await createWorld();
    const { tool } = setUp(world);
    const reply = await tool('set_schedule', {
      message: 'Check the build.',
      daily_at: '09:00',
      weekdays: [1, 2, 3, 4, 5],
    });
    const schedule = only(world);
    expect(schedule.timeZone).toBe('Europe/Berlin');
    expect(reply).toBe(
      `Saved “Check the build.” (schedule_id ${schedule.id}). Weekdays at 09:00 in Europe/Berlin. Next run ${new Date(schedule.nextRunAt ?? 0).toISOString()}. It messages this task.`
    );
  });

  test('a paused schedule for new tasks says so', async () => {
    const world = await createWorld();
    const { tool } = setUp(world);
    const reply = await tool('set_schedule', {
      message: 'Audit.',
      every_minutes: 60,
      new_task: true,
      enabled: false,
      time_zone: 'UTC',
    });
    expect(reply).toContain('Every hour. Next run');
    expect(reply).toContain('It is paused. Starts a new task.');
  });

  test('a watch set by an agent is suggested for the human to accept, and once accepted reads in a home of its own', async () => {
    const base = await createWorld();
    await base.engine.dispatch({
      type: 'repo.register',
      repo: { name: 'web', path: '/code/web', defaultBranch: 'main', remote: null, checkCommands: [] },
      projectName: 'Paywalls',
    });
    const repo = Object.values(base.engine.state.repos).find((candidate) => candidate.name === 'web');
    const projectId = repo?.projectId ?? '';
    const reader = await startTask(base.engine, repo?.id ?? '', base.dir, 'Read #feedback');
    const world = { ...base, ...reader };
    await world.engine.dispatch({
      type: 'watch_source.write',
      projectId,
      server: 'slack',
      data: 'The #feedback channel',
      repoIds: [],
    });
    const { tool } = setUp(world);
    const watch = {
      name: 'Feedback bugs',
      message: 'Bug reports and feature requests.',
      every_minutes: 60,
      source: 'slack',
    };
    const reply = await tool('set_schedule', watch);
    expect(world.engine.state.schedules).toEqual({});
    expect(reply).toStartWith('Suggested the watch “Feedback bugs” for the human to accept.');
    expect(await tool('set_schedule', watch)).toBe(reply);
    const [suggestion] = Object.values(world.engine.state.watchSuggestions);
    await world.engine.dispatch({ type: 'watch_suggestion.accept', suggestionId: suggestion?.id ?? '' });
    const schedule = only(world);
    expect(schedule.source).toEqual({ projectId, server: 'slack' });
    const homeId = schedule.target.kind === 'task' ? schedule.target.taskId : '';
    expect(homeId).not.toBe(reader.taskId);
    expect(world.engine.state.tasks[homeId]?.watchHome).toBe(true);
  });

  test('a message into another task names it', async () => {
    const world = await createWorld();
    const other = await startTask(world.engine, world.repoId, world.dir, 'Another task');
    const { tool } = setUp(world);
    const reply = await tool('set_schedule', { message: 'Nudge.', every_minutes: 30, task_id: other.taskId });
    expect(reply).toContain('Messages “Another task”.');
  });

  test('a webhook gets a URL, and its signing secret comes from a one-use ref', async () => {
    const world = await createWorld();
    const { tool } = setUp(world);
    const ref = world.secrets.writeRef('gate-1', world.taskId, 'shh');
    const reply = await tool('set_schedule', {
      message: 'A push: {{body.ref}}',
      webhook: { signature: { header: 'X-Hub-Signature-256', prefix: 'sha256=', secret_ref: ref } },
    });
    const schedule = only(world);
    const hook = world.secrets.selectHook(schedule.id);
    expect(hook?.secret).toBe('shh');
    expect(reply).toContain(`Its URL is http://127.0.0.1:5180/api/hooks/${schedule.id}/${hook?.token}.`);
    expect(reply).toContain('Requests must carry a valid x-hub-signature-256 signature.');
    expect(reply).not.toContain('shh');
    expect(() => world.secrets.removeRef(ref, world.taskId)).toThrow('has been used');
  });

  test('a signature check without a secret is refused until a ref is given', async () => {
    const world = await createWorld();
    const { tool } = setUp(world);
    const signed = { webhook: { signature: { header: 'x-sig' } }, message: 'Hook' };
    await expect(tool('set_schedule', signed)).rejects.toThrow('request_secret');
    expect(world.engine.state.schedules).toEqual({});
  });

  test('a used ref still saves the schedule and says how to set the secret', async () => {
    const world = await createWorld();
    const { tool } = setUp(world);
    const reply = await tool('set_schedule', {
      message: 'Hook',
      webhook: { signature: { header: 'x-sig', secret_ref: `secret-ref:${'0'.repeat(32)}` } },
    });
    const schedule = only(world);
    expect(reply).toContain('The schedule was saved, but its signing secret was not:');
    expect(reply).toContain(`set_schedule with schedule_id ${schedule.id}`);
  });

  test('a repeat of the same set_schedule call with its spent ref is answered as the first was', async () => {
    const world = await createWorld();
    const { schedules, call } = setUp(world);
    const repeated = {
      ...call,
      dispatch: (command: ShinsaCommand) => world.engine.dispatch(command, { id: 'mcp:7' }),
    };
    const ref = world.secrets.writeRef('gate-1', world.taskId, 'shh');
    const input = { message: 'Hook', webhook: { signature: { header: 'x-sig', secret_ref: ref } } };
    const first = await schedules.handleTool('set_schedule', input, repeated);
    const again = await schedules.handleTool('set_schedule', input, repeated);
    expect(again).toBe(first ?? '');
    expect(again).not.toContain('was not');
    expect(world.secrets.selectHook(only(world).id)?.secret).toBe('shh');
  });

  test('changing a signed webhook keeps its secret without a new ref', async () => {
    const world = await createWorld();
    const { tool } = setUp(world);
    const ref = world.secrets.writeRef('gate-1', world.taskId, 'shh');
    await tool('set_schedule', {
      message: 'Hook',
      webhook: { signature: { header: 'x-sig', secret_ref: ref } },
    });
    const id = only(world).id;
    const reply = await tool('set_schedule', {
      schedule_id: id,
      name: 'Renamed hook',
      webhook: { signature: { header: 'x-sig' } },
    });
    expect(reply).toContain('Saved “Renamed hook”');
    expect(world.secrets.selectHook(id)?.secret).toBe('shh');
  });

  test('an edit that does not restate the time zone keeps the schedule’s own zone', async () => {
    const world = await createWorld();
    const { tool } = setUp(world);
    await tool('set_schedule', { message: 'Standup', daily_at: '09:00', time_zone: 'Asia/Tokyo' });
    const id = only(world).id;
    const reply = await tool('set_schedule', { schedule_id: id, name: 'Morning standup' });
    expect(only(world).timeZone).toBe('Asia/Tokyo');
    expect(reply).toContain('Every day at 09:00 in Asia/Tokyo');
  });

  test('a change that changes nothing describes the schedule as it is', async () => {
    const world = await createWorld();
    const { tool } = setUp(world);
    await tool('set_schedule', { message: 'Ping', in_minutes: 30 });
    const id = only(world).id;
    expect(await tool('set_schedule', { schedule_id: id })).toContain(`(schedule_id ${id}). Once.`);
  });

  test('refuses a broken request with every problem, and a run that is gone', async () => {
    const world = await createWorld();
    const { schedules, call } = setUp(world);
    await expect(
      schedules.handleTool('set_schedule', { in_minutes: 1, every_minutes: 1 }, call)
    ).rejects.toThrow('not several');
    await expect(
      schedules.handleTool('set_schedule', { in_minutes: 1 }, { ...call, runId: 'gone' })
    ).rejects.toThrow('This run no longer exists');
  });

  test('reports a schedule that a write did not save', async () => {
    const world = await createWorld();
    const { schedules, call } = setUp(world);
    const reply = schedules.handleTool(
      'set_schedule',
      { message: 'x', in_minutes: 5 },
      {
        ...call,
        dispatch: () => Promise.resolve([]),
      }
    );
    await expect(reply).rejects.toThrow('Nothing was saved.');
  });
});

describe('set_schedule refuses what it would drop', () => {
  test('signature fields on webhook itself are refused and point at webhook.signature', async () => {
    const world = await createWorld();
    const { tool } = setUp(world);
    const misplaced = {
      message: 'Hook',
      webhook: { header: 'x-sig', secret_ref: `secret-ref:${'0'.repeat(32)}` },
    };
    await expect(tool('set_schedule', misplaced)).rejects.toThrow(
      'header, secret_ref go under webhook.signature, not on webhook itself'
    );
    await expect(tool('set_schedule', { message: 'Hook', webhook: { secret: 'shh' } })).rejects.toThrow(
      'webhook has no secret. Its fields are signature, replay_key.'
    );
    expect(world.engine.state.schedules).toEqual({});
  });
});

describe('set_schedule with new_task in a repository it names', () => {
  async function registerWeb(world: World, projectName: string | null) {
    await world.engine.dispatch({
      type: 'repo.register',
      repo: { name: 'web', path: '/code/web', defaultBranch: 'main', remote: null, checkCommands: [] },
      projectName,
    });
    return Object.values(world.engine.state.repos).find((repo) => repo.name === 'web')?.id ?? '';
  }

  function repoOf(world: World) {
    const target = only(world).target;
    return target.kind === 'new_task' ? target.repoId : null;
  }

  test('by name or by id, and the calling task’s repository when it names none', async () => {
    const world = await createWorld();
    const webId = await registerWeb(world, null);
    const { tool } = setUp(world);
    const audit = { message: 'Audit.', every_minutes: 60, new_task: true };
    await tool('set_schedule', { ...audit, repository: 'web' });
    expect(repoOf(world)).toBe(webId);
    const id = only(world).id;
    await tool('set_schedule', { schedule_id: id, new_task: true, repository: world.repoId });
    expect(repoOf(world)).toBe(world.repoId);
    await tool('delete_schedule', { schedule_id: id });
    await tool('set_schedule', audit);
    expect(repoOf(world)).toBe(world.repoId);
  });

  test('a task in a project names only that project’s repositories', async () => {
    const base = await createWorld();
    const webId = await registerWeb(base, 'Paywalls');
    const reader = await startTask(base.engine, webId, base.dir, 'Read the paywall reports');
    const world = { ...base, ...reader };
    const { tool } = setUp(world);
    await expect(
      tool('set_schedule', { message: 'Audit.', every_minutes: 60, new_task: true, repository: 'app' })
    ).rejects.toThrow('There is no repository "app". Name one of: web.');
  });

  test('an unknown repository, or one without new_task, is refused', async () => {
    const world = await createWorld();
    const { tool } = setUp(world);
    const audit = { message: 'Audit.', every_minutes: 60 };
    await expect(tool('set_schedule', { ...audit, new_task: true, repository: 'nope' })).rejects.toThrow(
      'There is no repository "nope". Name one of: app.'
    );
    await expect(tool('set_schedule', { ...audit, repository: 'app' })).rejects.toThrow(
      'repository only goes with new_task'
    );
    expect(world.engine.state.schedules).toEqual({});
  });
});

describe('a schedule an agent writes with schedules_write', () => {
  function writeThroughSurface(world: World, schedules: Schedules, words: string[]) {
    const client = createManageClient({
      engine: world.engine,
      base: 'http://127.0.0.1:1',
      key: null,
      byTask: world.taskId,
      hookSecrets: schedules.hookSecrets(world.taskId),
    });
    const found = selectSpec(['schedules', 'write', ...words]);
    if (!found) throw new Error('no schedules write');
    return Effect.runPromise(found.spec.run(client, readArgv(found.spec.fields, found.rest).values));
  }

  test('is that task’s, so set_schedule and delete_schedule can change it', async () => {
    const world = await createWorld();
    const { schedules, tool } = setUp(world);
    await writeThroughSurface(world, schedules, [
      '--message',
      'Audit.',
      '--every-minutes',
      '60',
      '--new-task',
      '--time-zone',
      'UTC',
    ]);
    const schedule = only(world);
    expect(schedule.createdBy).toEqual({ kind: 'agent', taskId: world.taskId, runId: null });
    expect(await tool('set_schedule', { schedule_id: schedule.id, name: 'Hourly audit' })).toContain(
      'Saved “Hourly audit”'
    );
    expect(await tool('delete_schedule', { schedule_id: schedule.id })).toBe('Deleted “Hourly audit”.');
  });

  test('its signing secret comes from the ref, as with set_schedule', async () => {
    const world = await createWorld();
    const { schedules } = setUp(world);
    const ref = world.secrets.writeRef('gate-1', world.taskId, 'shh');
    const hook = [
      '--message',
      'Push',
      '--new-task',
      '--webhook',
      '--signature-header',
      'x-sig',
      '--time-zone',
      'UTC',
    ];
    await expect(writeThroughSurface(world, schedules, hook)).rejects.toThrow(
      'pass the secret-ref it returns as signature_secret_ref.'
    );
    expect(world.engine.state.schedules).toEqual({});
    const result = await writeThroughSurface(world, schedules, [...hook, '--signature-secret-ref', ref]);
    const id = only(world).id;
    expect(result.data).toEqual({ ok: true, taskId: null, scheduleId: id });
    expect(world.secrets.selectHook(id)?.secret).toBe('shh');
    expect(result.text).not.toContain('was not');
    const again = await writeThroughSurface(world, schedules, ['--id', id, ...hook]);
    expect(again.text).toContain('Saved the schedule.');
    expect(world.secrets.selectHook(id)?.secret).toBe('shh');
  });

  test('a spent ref still saves the schedule and says how to set the secret', async () => {
    const world = await createWorld();
    const { schedules } = setUp(world);
    const result = await writeThroughSurface(world, schedules, [
      '--message',
      'Push',
      '--new-task',
      '--webhook',
      '--signature-header',
      'x-sig',
      '--signature-secret-ref',
      `secret-ref:${'0'.repeat(32)}`,
      '--time-zone',
      'UTC',
    ]);
    expect(result.text).toContain(`The schedule was saved, but its signing secret was not:`);
    expect(result.text).toContain(`set_schedule with schedule_id ${only(world).id}`);
  });

  test('a secret for a schedule that is gone is not written', async () => {
    const world = await createWorld();
    const { schedules } = setUp(world);
    const ref = world.secrets.writeRef('gate-1', world.taskId, 'shh');
    expect(schedules.hookSecrets(world.taskId).writeSecret('gone', ref)).toBeNull();
    expect(world.secrets.hasRef(ref)).toBe(true);
  });
});

describe('list_schedules and delete_schedule', () => {
  test('lists every schedule with its last runs, and the URL only of this task’s webhooks', async () => {
    const world = await createWorld();
    const { tool } = setUp(world);
    await tool('set_schedule', { message: 'Hook', webhook: true });
    const hook = only(world);
    await world.engine.dispatch({
      type: 'schedule.deliver',
      scheduleId: hook.id,
      deliveryId: 'd1',
      text: 'Go',
      replayKey: null,
    });
    await world.engine.dispatch({
      type: 'schedule.fail',
      scheduleId: hook.id,
      dueAt: null,
      deliveryId: 'd2',
      detail: 'No.',
    });
    const listed = JSON.parse(await tool('list_schedules'));
    expect(listed.now).toBe(new Date(NOW).toISOString());
    expect(listed.schedules[0]).toMatchObject({
      schedule_id: hook.id,
      when: 'When its webhook is called',
      yours: true,
      url: expect.stringContaining(`/api/hooks/${hook.id}/`),
      last_runs: [
        { outcome: 'sent', task_id: world.taskId },
        { outcome: 'failed', detail: 'No.' },
      ],
    });
    const other = await startTask(world.engine, world.repoId, world.dir, 'Another task');
    const { schedules, call } = setUp(world);
    const theirs = JSON.parse(
      (await schedules.handleTool('list_schedules', {}, { ...call, runId: other.runId })) ?? ''
    );
    expect(theirs.schedules[0].yours).toBe(false);
    expect(theirs.schedules[0].url).toBeUndefined();
  });

  test('deletes a schedule and forgets its webhook credentials', async () => {
    const world = await createWorld();
    const { tool } = setUp(world);
    await tool('set_schedule', { message: 'Hook', name: 'The hook', webhook: true });
    const id = only(world).id;
    expect(await tool('delete_schedule', { schedule_id: id })).toBe('Deleted “The hook”.');
    expect(world.secrets.selectHook(id)).toBeNull();
    await expect(tool('delete_schedule', {})).rejects.toThrow('schedule_id is required.');
  });

  test('other tools are not schedule tools', async () => {
    const world = await createWorld();
    const { schedules, call } = setUp(world);
    expect(schedules.handleTool('ask', {}, call)).toBeNull();
  });
});

async function startIntakeRead(world: World) {
  const engine = world.engine;
  await engine.dispatch({
    type: 'repo.register',
    repo: { name: 'web', path: '/code/web', defaultBranch: 'main', remote: null, checkCommands: [] },
    projectName: 'Paywalls',
  });
  const repo = Object.values(engine.state.repos).find((candidate) => candidate.name === 'web');
  const projectId = repo?.projectId ?? '';
  await engine.dispatch({
    type: 'watch_source.write',
    projectId,
    server: 'slack',
    data: 'The #feedback channel',
    repoIds: [],
  });
  await engine.dispatch({
    type: 'schedule.write',
    scheduleId: null,
    name: 'Feedback',
    text: 'Bug reports.',
    trigger: { kind: 'webhook', signature: null, replayKey: null },
    target: null,
    source: { projectId, server: 'slack' },
    enabled: null,
    maxRuns: null,
    timeZone: 'UTC',
  });
  const schedule = Object.values(engine.state.schedules).find((candidate) => candidate.source !== null);
  const taskId = schedule?.target.kind === 'task' ? schedule.target.taskId : '';
  await engine.dispatch({
    type: 'schedule.deliver',
    scheduleId: schedule?.id ?? '',
    deliveryId: 'd1',
    text: 'A new message.',
    replayKey: null,
  });
  return { taskId, runId: listActiveRuns(engine.state, taskId)[0]?.id ?? '' };
}

describe('file_report', () => {
  const report = {
    title: 'Editor loses edits',
    request: 'Keep unsaved edits when the tab reloads.',
    link: 'https://slack.com/p1',
    text: 'I lost my edits.',
  };

  test('files the report as a task, a fork of the task it names by handle, in the repository it names', async () => {
    const world = await createWorld();
    const read = await startIntakeRead(world);
    const { tool } = setUp({ ...world, runId: read.runId });
    const shipped = world.engine.state.tasks[world.taskId];
    const reply = await tool('file_report', {
      ...report,
      fork_from: shipped?.id,
      repository: 'web',
    });
    const filed = Object.values(world.engine.state.tasks).find((task) => task.sourceReport);
    expect(reply).toBe(`Filed ${filed?.handle} “${filed?.title}”. Go on with the next report.`);
    expect(filed?.forkOf).toBe(world.taskId);
    expect(filed?.repoId).toBe(
      Object.values(world.engine.state.repos).find((repo) => repo.name === 'web')?.id ?? ''
    );
    await expect(tool('file_report', { ...report, report_id: 'p2', link: undefined })).resolves.toContain(
      'Filed'
    );
    await expect(tool('file_report', report)).rejects.toThrow('This report was already filed as');
  });

  test('refuses a broken report, a task or repository it cannot find, and a call that files nothing', async () => {
    const world = await createWorld();
    const read = await startIntakeRead(world);
    const { tool, call } = setUp({ ...world, runId: read.runId });
    await expect(tool('file_report', { title: 'x' })).rejects.toThrow('report_id or link');
    await expect(tool('file_report', { ...report, fork_from: 'LOC-999' })).rejects.toThrow(
      'There is no task "LOC-999" to fork.'
    );
    await expect(tool('file_report', { ...report, repository: 'app' })).rejects.toThrow(
      'There is no repository "app". Name one of: web.'
    );
    const silent = new Schedules(world.engine, world.secrets, {
      baseUrl: () => '',
      timeZone: 'UTC',
      now: () => NOW,
    });
    const reply = silent.handleTool('file_report', report, { ...call, dispatch: async () => [] });
    await expect(reply ?? Promise.resolve('')).rejects.toThrow('Nothing was filed.');
  });

  test('a report another watch filed first is counted by the watchdog that finds it, not filed again', async () => {
    const world = await createWorld();
    const read = await startIntakeRead(world);
    const { call } = setUp({ ...world, runId: read.runId });
    const known = world.engine.state.tasks[world.taskId];
    const linked = new Schedules(world.engine, world.secrets, {
      baseUrl: () => '',
      timeZone: 'UTC',
      now: () => NOW,
    });
    const event = {
      type: 'watchdog.report_linked',
      taskId: 't',
      watchdogId: 'w',
      reportTaskId: world.taskId,
    };
    const reply = linked.handleTool('file_report', report, {
      ...call,
      dispatch: async () => [event] as unknown as ShinsaEvent[],
    });
    await expect(reply ?? Promise.resolve('')).resolves.toBe(
      `This report was already filed as ${known?.handle} “${known?.title}”, so the watchdog counts it. Go on with the next report.`
    );
  });
});

describe('a webhook’s URL', () => {
  test('is the local route with its token, and a schedule without a webhook has none', async () => {
    const world = await createWorld();
    const { schedules, tool } = setUp(world);
    await tool('set_schedule', { message: 'Hook', webhook: {} });
    const schedule = only(world);
    const hook = world.secrets.selectHook(schedule.id);
    expect(findHookUrl(schedules.context, schedule.id)).toBe(
      `http://127.0.0.1:5180/api/hooks/${schedule.id}/${hook?.token}`
    );
    expect(() => findHookUrl(schedules.context, 'nope')).toThrow('This schedule has no webhook.');
  });
});
