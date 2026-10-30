import { afterEach, describe, expect, test } from 'bun:test';
import { listActiveRuns, type ShinsaCommand, type ShinsaEvent } from '@shinsa/core';
import { Schedules } from '../../src/schedules/index.ts';
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

  test('a watch set by an agent reads in a home of its own and says what it watches', async () => {
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
    const reply = await tool('set_schedule', {
      message: 'Bug reports and feature requests.',
      every_minutes: 60,
      source: 'slack',
    });
    const schedule = only(world);
    expect(schedule.source).toEqual({ projectId, server: 'slack' });
    const homeId = schedule.target.kind === 'task' ? schedule.target.taskId : '';
    expect(homeId).not.toBe(reader.taskId);
    expect(world.engine.state.tasks[homeId]?.watchHome).toBe(true);
    expect(reply).toEndWith('Watches slack and files a task for each new report.');
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
      'The project has no repository "app". Its repositories: web.'
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
