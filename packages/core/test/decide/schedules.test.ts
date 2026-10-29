import { describe, expect, test } from 'bun:test';
import {
  type CommandOf,
  resolveTaskRounds,
  SCHEDULE_LIMITS,
  type Schedule,
  type ScheduleTargetInput,
  type ScheduleTrigger,
} from '../../src/index.ts';
import {
  buildAll,
  createHarness,
  createTask,
  type Harness,
  PASSING,
  registerRepo,
  shipAndMerge,
} from '../harness.ts';

const MINUTE = 60_000;

const ZONE = 'Europe/Berlin';

function schedule(harness: Harness, taskId: string, input: Partial<CommandOf<'agent.set_schedule'>> = {}) {
  return harness.send({
    type: 'agent.set_schedule',
    runId: harness.activeRun(taskId).id,
    scheduleId: null,
    name: null,
    text: 'Check the nightly build.',
    trigger: { kind: 'interval', everyMinutes: 30 },
    target: null,
    source: null,
    enabled: null,
    maxRuns: null,
    timeZone: ZONE,
    ...input,
  });
}

function only(harness: Harness): Schedule {
  const [first] = Object.values(harness.state.schedules);
  if (!first) throw new Error('no schedule');
  return first;
}

function newTaskTarget(overrides: Partial<Extract<ScheduleTargetInput, { kind: 'new_task' }>> = {}) {
  return { kind: 'new_task', priority: 'normal', mode: 'build', ...overrides } as const;
}

function createScheduling() {
  const harness = createHarness();
  const taskId = createTask(harness);
  harness.advance(24 * 60 * MINUTE);
  return { harness, taskId };
}

describe('setting a schedule', () => {
  test('defaults to messaging the agent’s own task and names it from the message', () => {
    const { harness, taskId } = createScheduling();
    schedule(harness, taskId, { text: 'Check the nightly build.\nThen report back.' });
    const created = only(harness);
    expect(created.name).toBe('Check the nightly build.');
    expect(created.target).toEqual({ kind: 'task', taskId });
    expect(created.createdBy).toEqual({ kind: 'agent', taskId, runId: harness.activeRun(taskId).id });
    expect(created.enabled).toBe(true);
    expect(created.stopped).toBeNull();
    expect(created.nextRunAt).toBe(created.createdAt + 30 * MINUTE);
  });

  test('a daily trigger keeps its wall-clock time in the schedule’s time zone', () => {
    const { harness, taskId } = createScheduling();
    schedule(harness, taskId, { trigger: { kind: 'daily', time: '09:00', weekdays: [] }, timeZone: 'UTC' });
    const next = only(harness).nextRunAt ?? 0;
    expect(new Date(next).getUTCHours()).toBe(9);
    expect(next).toBeGreaterThan(only(harness).createdAt);
  });

  test('a one-off run keeps its own time even when that second has just passed', () => {
    const { harness, taskId } = createScheduling();
    const at = harness.now;
    schedule(harness, taskId, { trigger: { kind: 'once', at } });
    expect(only(harness).nextRunAt).toBe(at);
  });

  test('a new task target takes the agent’s repository', () => {
    const { harness, taskId } = createScheduling();
    schedule(harness, taskId, { target: newTaskTarget({ priority: 'high', mode: 'ask' }) });
    expect(only(harness).target).toEqual({
      kind: 'new_task',
      repoId: harness.task(taskId).repoId,
      priority: 'high',
      mode: 'ask',
    });
  });

  test('a message target can be another open task', () => {
    const { harness, taskId } = createScheduling();
    const other = createTask(harness, { request: 'Another one' });
    schedule(harness, taskId, { target: { kind: 'task', taskId: other } });
    expect(only(harness).target).toEqual({ kind: 'task', taskId: other });
  });

  test('a webhook has no next run and keeps its signature and replay key', () => {
    const { harness, taskId } = createScheduling();
    const trigger: ScheduleTrigger = {
      kind: 'webhook',
      signature: { header: 'x-hub-signature-256', encoding: 'hex', prefix: 'sha256=' },
      replayKey: '{{headers.x-github-delivery}}',
    };
    schedule(harness, taskId, { trigger });
    expect(only(harness).trigger).toEqual(trigger);
    expect(only(harness).nextRunAt).toBeNull();
  });

  test.each<[string, Partial<CommandOf<'agent.set_schedule'>>, string]>([
    ['an unknown time zone', { timeZone: 'Mars/Olympus' }, 'is not a time zone'],
    ['no trigger', { trigger: null }, 'Say when it runs'],
    ['no message', { text: '  ' }, 'needs a message'],
    ['a message past the limit', { text: 'x'.repeat(SCHEDULE_LIMITS.text + 1) }, 'the limit is'],
    ['a time long gone', { trigger: { kind: 'once', at: 0 } }, 'already passed'],
    ['a time years away', { trigger: { kind: 'once', at: 10 ** 13 } }, 'at most a year'],
    ['an interval of zero', { trigger: { kind: 'interval', everyMinutes: 0 } }, 'every 1 to'],
    ['an interval in fractions', { trigger: { kind: 'interval', everyMinutes: 1.5 } }, 'every 1 to'],
    [
      'a made-up time of day',
      { trigger: { kind: 'daily', time: '25:00', weekdays: [] } },
      'not a time of day',
    ],
    ['a weekday out of range', { trigger: { kind: 'daily', time: '09:00', weekdays: [7] } }, 'Weekdays are'],
    ['a weekday twice', { trigger: { kind: 'daily', time: '09:00', weekdays: [1, 1] } }, 'Weekdays are'],
    [
      'a signature header with spaces',
      {
        trigger: {
          kind: 'webhook',
          signature: { header: 'x hub', encoding: 'hex', prefix: '' },
          replayKey: null,
        },
      },
      'letters, digits and dashes',
    ],
    [
      'a signature prefix past the limit',
      {
        trigger: {
          kind: 'webhook',
          signature: { header: 'x-sig', encoding: 'hex', prefix: 'p'.repeat(SCHEDULE_LIMITS.prefix + 1) },
          replayKey: null,
        },
      },
      'prefix can be at most',
    ],
    [
      'a replay key without a placeholder',
      { trigger: { kind: 'webhook', signature: null, replayKey: 'static' } },
      'must name a part of the request',
    ],
    ['max runs of zero', { maxRuns: 0 }, 'max_runs is 1 to'],
    ['a task that does not exist', { target: { kind: 'task', taskId: 'nope' } }, 'No task nope'],
  ])('refuses %s', (_name, input, message) => {
    const { harness, taskId } = createScheduling();
    expect(() => schedule(harness, taskId, input)).toThrow(message);
    expect(Object.keys(harness.state.schedules)).toHaveLength(0);
  });

  test('refuses to message a closed task', () => {
    const { harness, taskId } = createScheduling();
    const other = createTask(harness, { request: 'Done already' });
    harness.send({ type: 'task.cancel', taskId: other });
    expect(() => schedule(harness, taskId, { target: { kind: 'task', taskId: other } })).toThrow('is closed');
  });

  test('a reviewer can schedule a message to its own task', () => {
    const { harness, taskId } = createScheduling();
    buildAll(harness, taskId);
    harness.send({ type: 'checks.record', taskId, results: PASSING });
    const reviewer = harness.activeRun(taskId);
    expect(reviewer.role).toBe('reviewer');
    schedule(harness, taskId);
    expect(only(harness).target).toEqual({ kind: 'task', taskId });
    expect(only(harness).createdBy).toEqual({ kind: 'agent', taskId, runId: reviewer.id });
  });

  test('refuses a run that does not exist', () => {
    const harness = createHarness();
    expect(() =>
      harness.send({
        type: 'agent.set_schedule',
        runId: 'missing',
        scheduleId: null,
        name: null,
        text: 'x',
        trigger: { kind: 'interval', everyMinutes: 5 },
        target: null,
        source: null,
        enabled: null,
        maxRuns: null,
        timeZone: ZONE,
      })
    ).toThrow('No run missing');
  });

  test('stops at the number of schedules one task may keep', () => {
    const { harness, taskId } = createScheduling();
    for (let index = 0; index < SCHEDULE_LIMITS.perTask; index += 1)
      schedule(harness, taskId, { name: `S${index}` });
    expect(() => schedule(harness, taskId)).toThrow('as many schedules as Shinsa keeps');
  });
});

describe('changing a schedule', () => {
  test('a new name or message keeps the next run', () => {
    const { harness, taskId } = createScheduling();
    schedule(harness, taskId);
    const before = only(harness);
    harness.advance(5 * MINUTE);
    schedule(harness, taskId, { scheduleId: before.id, name: 'Renamed', text: 'New words', trigger: null });
    expect(only(harness).name).toBe('Renamed');
    expect(only(harness).text).toBe('New words');
    expect(only(harness).nextRunAt).toBe(before.nextRunAt);
  });

  test('a new trigger starts the clock again', () => {
    const { harness, taskId } = createScheduling();
    schedule(harness, taskId);
    const before = only(harness);
    harness.advance(5 * MINUTE);
    schedule(harness, taskId, { scheduleId: before.id, trigger: { kind: 'interval', everyMinutes: 60 } });
    expect(only(harness).nextRunAt).toBeGreaterThan(before.nextRunAt ?? 0);
  });

  test('the same trigger and words change nothing', () => {
    const { harness, taskId } = createScheduling();
    schedule(harness, taskId);
    const before = only(harness);
    const decision = schedule(harness, taskId, { scheduleId: before.id, trigger: before.trigger });
    expect(decision.events).toHaveLength(0);
  });

  test('pausing keeps the next run and resuming starts the clock again', () => {
    const { harness, taskId } = createScheduling();
    schedule(harness, taskId);
    const id = only(harness).id;
    const next = only(harness).nextRunAt;
    schedule(harness, taskId, { scheduleId: id, enabled: false });
    expect(only(harness).enabled).toBe(false);
    expect(only(harness).nextRunAt).toBe(next);
    harness.advance(MINUTE);
    schedule(harness, taskId, { scheduleId: id, enabled: true });
    expect(only(harness).enabled).toBe(true);
    expect(only(harness).nextRunAt).toBeGreaterThan(next ?? 0);
  });

  test('will not turn a finished one-off back on without a new time', () => {
    const { harness, taskId } = createScheduling();
    schedule(harness, taskId, { trigger: { kind: 'once', at: harness.now + MINUTE } });
    const id = only(harness).id;
    harness.advance(5 * MINUTE);
    harness.send({ type: 'schedule.fire', scheduleId: id, dueAt: only(harness).nextRunAt ?? 0 });
    expect(() => schedule(harness, taskId, { scheduleId: id, enabled: true, trigger: null })).toThrow(
      'already passed'
    );
    schedule(harness, taskId, {
      scheduleId: id,
      enabled: true,
      trigger: { kind: 'once', at: harness.now + MINUTE },
    });
    expect(only(harness)).toMatchObject({
      enabled: true,
      stopped: null,
      nextRunAt: harness.now - 1 + MINUTE,
    });
  });

  test('refuses another task’s schedule and one that does not exist', () => {
    const { harness, taskId } = createScheduling();
    schedule(harness, taskId);
    const other = createTask(harness, { request: 'Second' });
    const id = only(harness).id;
    expect(() => schedule(harness, other, { scheduleId: id })).toThrow('belongs to another task');
    expect(() => schedule(harness, taskId, { scheduleId: 'nope' })).toThrow('No schedule nope');
  });

  test('refuses to run again once it has used every run', () => {
    const { harness, taskId } = createScheduling();
    schedule(harness, taskId, { maxRuns: 1 });
    const id = only(harness).id;
    harness.advance(30 * MINUTE);
    harness.send({ type: 'schedule.fire', scheduleId: id, dueAt: only(harness).nextRunAt ?? 0 });
    expect(only(harness).stopped).toBe('finished');
    expect(() => schedule(harness, taskId, { scheduleId: id, enabled: true })).toThrow('Raise max_runs');
    schedule(harness, taskId, { scheduleId: id, maxRuns: 5, enabled: true, trigger: null });
    expect(only(harness).stopped).toBeNull();
  });

  test('an agent deletes its own schedule', () => {
    const { harness, taskId } = createScheduling();
    schedule(harness, taskId);
    harness.send({
      type: 'agent.delete_schedule',
      runId: harness.activeRun(taskId).id,
      scheduleId: only(harness).id,
    });
    expect(Object.keys(harness.state.schedules)).toHaveLength(0);
  });
});

describe('pausing, resuming and removing from Settings', () => {
  test('pauses and resumes', () => {
    const { harness, taskId } = createScheduling();
    schedule(harness, taskId);
    const id = only(harness).id;
    harness.send({ type: 'schedule.enable', scheduleId: id, enabled: false });
    expect(only(harness).enabled).toBe(false);
    expect(harness.send({ type: 'schedule.enable', scheduleId: id, enabled: false }).events).toHaveLength(0);
    harness.advance(MINUTE);
    harness.send({ type: 'schedule.enable', scheduleId: id, enabled: true });
    expect(only(harness).enabled).toBe(true);
  });

  test('a webhook resumes without a next run', () => {
    const { harness, taskId } = createScheduling();
    schedule(harness, taskId, { trigger: { kind: 'webhook', signature: null, replayKey: null } });
    const id = only(harness).id;
    harness.send({ type: 'schedule.enable', scheduleId: id, enabled: false });
    harness.send({ type: 'schedule.enable', scheduleId: id, enabled: true });
    expect(only(harness).enabled).toBe(true);
    expect(only(harness).nextRunAt).toBeNull();
  });

  test('will not resume a one-off whose time has passed', () => {
    const { harness, taskId } = createScheduling();
    schedule(harness, taskId, {
      trigger: { kind: 'once', at: harness.now + MINUTE },
    });
    const id = only(harness).id;
    harness.send({ type: 'schedule.enable', scheduleId: id, enabled: false });
    harness.advance(10 * MINUTE);
    expect(() => harness.send({ type: 'schedule.enable', scheduleId: id, enabled: true })).toThrow(
      'Its time has passed'
    );
  });

  test('will not resume one that finished or lost its task', () => {
    const { harness, taskId } = createScheduling();
    schedule(harness, taskId, { maxRuns: 1 });
    const id = only(harness).id;
    harness.advance(30 * MINUTE);
    harness.send({ type: 'schedule.fire', scheduleId: id, dueAt: only(harness).nextRunAt ?? 0 });
    expect(() => harness.send({ type: 'schedule.enable', scheduleId: id, enabled: true })).toThrow(
      'finished its runs'
    );

    const second = createScheduling();
    schedule(second.harness, second.taskId);
    const gone = only(second.harness);
    second.harness.send({ type: 'task.cancel', taskId: second.taskId });
    second.harness.advance(30 * MINUTE);
    second.harness.send({ type: 'schedule.fire', scheduleId: gone.id, dueAt: gone.nextRunAt ?? 0 });
    expect(only(second.harness).stopped).toBe('target_gone');
    expect(() =>
      second.harness.send({ type: 'schedule.enable', scheduleId: gone.id, enabled: true })
    ).toThrow('The task it messages is closed');
  });

  test('refuses an unknown schedule; removing one that is gone changes nothing', () => {
    const harness = createHarness();
    expect(() => harness.send({ type: 'schedule.enable', scheduleId: 'nope', enabled: true })).toThrow(
      'no longer exists'
    );
    expect(harness.send({ type: 'schedule.remove', scheduleId: 'nope' }).events).toHaveLength(0);
  });

  test('removes a schedule', () => {
    const { harness, taskId } = createScheduling();
    schedule(harness, taskId);
    harness.send({ type: 'schedule.remove', scheduleId: only(harness).id });
    expect(harness.state.schedules).toEqual({});
  });
});

describe('firing a schedule', () => {
  test('a message steers the running agent and names the schedule in the activity', () => {
    const { harness, taskId } = createScheduling();
    schedule(harness, taskId, { name: 'Nightly check' });
    const created = only(harness);
    harness.advance(30 * MINUTE);
    const decision = harness.send({
      type: 'schedule.fire',
      scheduleId: created.id,
      dueAt: created.nextRunAt ?? 0,
    });
    expect(decision.effects).toContainEqual({
      kind: 'run.steer',
      runId: harness.activeRun(taskId).id,
      text: 'Check the nightly build.',
    });
    expect(harness.task(taskId).activity.at(-1)).toMatchObject({
      actor: 'shinsa',
      kind: 'message',
      text: 'Sent instructions from the schedule “Nightly check”',
    });
    const fired = only(harness);
    expect(fired.runs).toEqual([
      expect.objectContaining({ outcome: 'sent', taskId, deliveryId: null, detail: null }),
    ]);
    expect(fired.runCount).toBe(1);
    expect(fired.lastRunId).toBe(harness.activeRun(taskId).id);
  });

  test('skips while the run its last message reached is still going, without counting it', () => {
    const { harness, taskId } = createScheduling();
    schedule(harness, taskId, { maxRuns: 2 });
    const id = only(harness).id;
    harness.advance(30 * MINUTE);
    harness.send({ type: 'schedule.fire', scheduleId: id, dueAt: only(harness).nextRunAt ?? 0 });
    harness.advance(30 * MINUTE);
    harness.send({ type: 'schedule.fire', scheduleId: id, dueAt: only(harness).nextRunAt ?? 0 });
    const skipped = only(harness);
    expect(skipped.runs.at(-1)).toMatchObject({
      outcome: 'skipped',
      detail: expect.stringContaining('still going'),
    });
    expect(skipped.runCount).toBe(1);
    expect(skipped.stopped).toBeNull();
  });

  test('a missed run fires once on wake and the next run counts from then', () => {
    const { harness, taskId } = createScheduling();
    schedule(harness, taskId, { trigger: { kind: 'interval', everyMinutes: 10 } });
    const created = only(harness);
    harness.advance(7 * 24 * 60 * MINUTE);
    harness.send({ type: 'schedule.fire', scheduleId: created.id, dueAt: created.nextRunAt ?? 0 });
    const fired = only(harness);
    expect(fired.runs).toHaveLength(1);
    expect((fired.nextRunAt ?? 0) - (fired.runs[0]?.at ?? 0)).toBe(10 * MINUTE);
  });

  test('ignores a stale, early, paused or webhook fire', () => {
    const { harness, taskId } = createScheduling();
    schedule(harness, taskId);
    const created = only(harness);
    expect(harness.send({ type: 'schedule.fire', scheduleId: created.id, dueAt: 1 }).events).toHaveLength(0);
    expect(
      harness.send({ type: 'schedule.fire', scheduleId: created.id, dueAt: created.nextRunAt ?? 0 }).events
    ).toHaveLength(0);
    harness.send({ type: 'schedule.enable', scheduleId: created.id, enabled: false });
    harness.advance(30 * MINUTE);
    expect(
      harness.send({ type: 'schedule.fire', scheduleId: created.id, dueAt: created.nextRunAt ?? 0 }).events
    ).toHaveLength(0);
    expect(harness.send({ type: 'schedule.fire', scheduleId: 'nope', dueAt: 1 }).events).toHaveLength(0);
    schedule(harness, taskId, { trigger: { kind: 'webhook', signature: null, replayKey: null } });
    const hook = Object.values(harness.state.schedules).find((entry) => entry.trigger.kind === 'webhook');
    expect(harness.send({ type: 'schedule.fire', scheduleId: hook?.id ?? '', dueAt: 0 }).events).toHaveLength(
      0
    );
  });

  test('a new task each run, skipped while the last one is open, then started again', () => {
    const { harness, taskId } = createScheduling();
    schedule(harness, taskId, { target: newTaskTarget(), name: 'Audit', text: 'Audit the dependencies.' });
    const id = only(harness).id;
    harness.advance(30 * MINUTE);
    harness.send({ type: 'schedule.fire', scheduleId: id, dueAt: only(harness).nextRunAt ?? 0 });
    const started = only(harness).lastTaskId ?? '';
    expect(harness.task(started)).toMatchObject({ request: 'Audit the dependencies.', scheduleId: id });
    expect(harness.task(started).activity[0]).toMatchObject({
      actor: 'shinsa',
      kind: 'asked',
      text: 'Started by the schedule “Audit”',
    });
    expect(harness.effectsOf('task.triage').at(-1)).toEqual({ kind: 'task.triage', taskId: started });

    harness.advance(30 * MINUTE);
    harness.send({ type: 'schedule.fire', scheduleId: id, dueAt: only(harness).nextRunAt ?? 0 });
    expect(only(harness).runs.at(-1)?.outcome).toBe('skipped');

    harness.send({ type: 'task.cancel', taskId: started });
    harness.advance(30 * MINUTE);
    harness.send({ type: 'schedule.fire', scheduleId: id, dueAt: only(harness).nextRunAt ?? 0 });
    expect(only(harness).runs.at(-1)?.outcome).toBe('sent');
    expect(only(harness).lastTaskId).not.toBe(started);
  });

  test('a one-off finishes after it runs', () => {
    const { harness, taskId } = createScheduling();
    schedule(harness, taskId, { trigger: { kind: 'once', at: harness.now + MINUTE } });
    harness.advance(5 * MINUTE);
    harness.send({
      type: 'schedule.fire',
      scheduleId: only(harness).id,
      dueAt: only(harness).nextRunAt ?? 0,
    });
    expect(only(harness)).toMatchObject({
      enabled: false,
      stopped: 'finished',
      nextRunAt: null,
      runCount: 1,
    });
  });

  test('messages a task resting after its merge, which starts its next round', () => {
    const { harness, taskId } = createScheduling();
    schedule(harness, taskId);
    const created = only(harness);
    shipAndMerge(harness, taskId);
    harness.advance(30 * MINUTE);
    harness.send({ type: 'schedule.fire', scheduleId: created.id, dueAt: created.nextRunAt ?? 0 });
    expect(only(harness)).toMatchObject({ enabled: true, runCount: 1 });
    expect(resolveTaskRounds(harness.task(taskId)).map((round) => round.status)).toEqual([
      'merged',
      'active',
    ]);
  });

  test('stops for good when the task it messages is closed', () => {
    const { harness, taskId } = createScheduling();
    schedule(harness, taskId);
    const created = only(harness);
    harness.send({ type: 'task.cancel', taskId });
    harness.advance(30 * MINUTE);
    harness.send({ type: 'schedule.fire', scheduleId: created.id, dueAt: created.nextRunAt ?? 0 });
    expect(only(harness)).toMatchObject({
      enabled: false,
      stopped: 'target_gone',
      nextRunAt: null,
      runCount: 0,
    });
    expect(only(harness).runs[0]).toMatchObject({
      outcome: 'skipped',
      detail: 'The task it messages is closed.',
    });
  });

  test('stops for good when the repository of its new tasks is removed', () => {
    const { harness, taskId } = createScheduling();
    schedule(harness, taskId, { target: newTaskTarget() });
    const created = only(harness);
    harness.send({ type: 'repo.remove', repoId: harness.task(taskId).repoId ?? '' });
    harness.advance(30 * MINUTE);
    harness.send({ type: 'schedule.fire', scheduleId: created.id, dueAt: created.nextRunAt ?? 0 });
    expect(only(harness).runs[0]?.detail).toBe('Its repository was removed.');
  });

  test('keeps the last twenty runs', () => {
    const { harness, taskId } = createScheduling();
    schedule(harness, taskId, { target: newTaskTarget(), trigger: { kind: 'interval', everyMinutes: 1 } });
    const id = only(harness).id;
    for (let index = 0; index < SCHEDULE_LIMITS.runsKept + 5; index += 1) {
      harness.advance(MINUTE);
      harness.send({ type: 'schedule.fire', scheduleId: id, dueAt: only(harness).nextRunAt ?? 0 });
    }
    expect(only(harness).runs).toHaveLength(SCHEDULE_LIMITS.runsKept);
  });

  test('an answered question can still be asked a follow-up by a schedule', () => {
    const harness = createHarness();
    const repoId = registerRepo(harness);
    harness.send({ type: 'task.create', request: 'How does it work?', repoId, mode: 'ask' });
    const askId = Object.keys(harness.state.tasks)[0] ?? '';
    const taskId = createTask(harness, { repoId });
    harness.send({
      type: 'task.triage',
      taskId: askId,
      title: 'Q',
      repoId,
      size: 'small',
      branch: 'q',
      waitsOn: [],
    });
    harness.send({ type: 'config.record', taskId: askId, problems: [] });
    harness.send({
      type: 'agent.deliver',
      runId: harness.activeRun(askId).id,
      step: 'answer',
      body: 'Like this.',
    });
    expect(harness.task(askId).stage).toBe('done');
    schedule(harness, taskId, { target: { kind: 'task', taskId: askId } });
    const created = only(harness);
    harness.advance(30 * MINUTE);
    harness.send({ type: 'schedule.fire', scheduleId: created.id, dueAt: created.nextRunAt ?? 0 });
    expect(only(harness).runs[0]?.outcome).toBe('sent');
  });
});

describe('webhook deliveries', () => {
  function hooked(replayKey: string | null = '{{headers.x-id}}') {
    const { harness, taskId } = createScheduling();
    schedule(harness, taskId, {
      target: newTaskTarget(),
      trigger: { kind: 'webhook', signature: null, replayKey },
      maxRuns: 3,
    });
    return { harness, taskId, id: only(harness).id };
  }

  test('each delivery starts a task, even while the last one is open', () => {
    const { harness, id } = hooked();
    harness.send({
      type: 'schedule.deliver',
      scheduleId: id,
      deliveryId: 'd1',
      text: 'First',
      replayKey: 'k1',
    });
    harness.send({
      type: 'schedule.deliver',
      scheduleId: id,
      deliveryId: 'd2',
      text: 'Second',
      replayKey: 'k2',
    });
    const runs = only(harness).runs;
    expect(runs.map((run) => [run.outcome, run.deliveryId])).toEqual([
      ['sent', 'd1'],
      ['sent', 'd2'],
    ]);
    expect(only(harness).nextRunAt).toBeNull();
  });

  test('a repeated replay key is dropped until it expires', () => {
    const { harness, id } = hooked();
    harness.send({
      type: 'schedule.deliver',
      scheduleId: id,
      deliveryId: 'd1',
      text: 'First',
      replayKey: 'k1',
    });
    const again = harness.send({
      type: 'schedule.deliver',
      scheduleId: id,
      deliveryId: 'd2',
      text: 'Again',
      replayKey: 'k1',
    });
    expect(again.events).toHaveLength(0);
    harness.advance(SCHEDULE_LIMITS.replayTtlMs);
    harness.send({
      type: 'schedule.deliver',
      scheduleId: id,
      deliveryId: 'd3',
      text: 'Later',
      replayKey: 'k1',
    });
    expect(only(harness).runs).toHaveLength(2);
    expect(Object.keys(only(harness).replayKeys)).toEqual(['k1']);
  });

  test('stops after its last run', () => {
    const { harness, id } = hooked(null);
    for (const index of [1, 2, 3]) {
      harness.send({
        type: 'schedule.deliver',
        scheduleId: id,
        deliveryId: `d${index}`,
        text: 'Go',
        replayKey: null,
      });
    }
    expect(only(harness)).toMatchObject({ stopped: 'finished', enabled: false, runCount: 3 });
    const after = harness.send({
      type: 'schedule.deliver',
      scheduleId: id,
      deliveryId: 'd4',
      text: 'Go',
      replayKey: null,
    });
    expect(after.events).toHaveLength(0);
  });

  test('ignores a timed schedule and an unknown one, and refuses an empty prompt', () => {
    const { harness, taskId, id } = hooked();
    expect(() =>
      harness.send({ type: 'schedule.deliver', scheduleId: id, deliveryId: 'd', text: '  ', replayKey: null })
    ).toThrow('empty');
    schedule(harness, taskId);
    const timed = Object.values(harness.state.schedules).find((entry) => entry.trigger.kind === 'interval');
    expect(
      harness.send({
        type: 'schedule.deliver',
        scheduleId: timed?.id ?? '',
        deliveryId: 'd',
        text: 'x',
        replayKey: null,
      }).events
    ).toHaveLength(0);
    expect(
      harness.send({
        type: 'schedule.deliver',
        scheduleId: 'nope',
        deliveryId: 'd',
        text: 'x',
        replayKey: null,
      }).events
    ).toHaveLength(0);
  });

  test('remembers at most the newest replay keys', () => {
    const { harness, id } = hooked();
    schedule(harness, Object.keys(harness.state.tasks)[0] ?? '', {
      scheduleId: id,
      maxRuns: 1000,
      trigger: null,
    });
    for (let index = 0; index <= SCHEDULE_LIMITS.replayKeys; index += 1) {
      harness.send({
        type: 'schedule.deliver',
        scheduleId: id,
        deliveryId: `d${index}`,
        text: 'Go',
        replayKey: `k${index}`,
      });
    }
    const keys = Object.keys(only(harness).replayKeys);
    expect(keys).toHaveLength(SCHEDULE_LIMITS.replayKeys);
    expect(keys).not.toContain('k0');
  });
});

describe('a run that could not be applied', () => {
  test('records the failure and moves the clock on without counting it', () => {
    const { harness, taskId } = createScheduling();
    schedule(harness, taskId);
    const created = only(harness);
    harness.advance(30 * MINUTE);
    harness.send({
      type: 'schedule.fail',
      scheduleId: created.id,
      dueAt: created.nextRunAt,
      deliveryId: null,
      detail: 'x'.repeat(500),
    });
    const failed = only(harness);
    expect(failed.runs[0]?.outcome).toBe('failed');
    expect(failed.runs[0]?.detail).toHaveLength(SCHEDULE_LIMITS.detail);
    expect(failed.runCount).toBe(0);
    expect(failed.nextRunAt).toBeGreaterThan(created.nextRunAt ?? 0);
  });

  test('a one-off that fails is finished', () => {
    const { harness, taskId } = createScheduling();
    schedule(harness, taskId, { trigger: { kind: 'once', at: harness.now + MINUTE } });
    const created = only(harness);
    harness.advance(5 * MINUTE);
    harness.send({
      type: 'schedule.fail',
      scheduleId: created.id,
      dueAt: created.nextRunAt,
      deliveryId: null,
      detail: 'No.',
    });
    expect(only(harness)).toMatchObject({ stopped: 'finished', enabled: false });
  });

  test('a failed delivery is recorded and its replay key is not', () => {
    const { harness, taskId } = createScheduling();
    schedule(harness, taskId, { trigger: { kind: 'webhook', signature: null, replayKey: null } });
    const id = only(harness).id;
    harness.send({
      type: 'schedule.fail',
      scheduleId: id,
      dueAt: null,
      deliveryId: 'd1',
      detail: 'Too long.',
    });
    expect(only(harness).runs[0]).toMatchObject({ outcome: 'failed', deliveryId: 'd1' });
    expect(only(harness).replayKeys).toEqual({});
  });

  test('ignores a stale failure, an unknown schedule and a delivery failure on a timed one', () => {
    const { harness, taskId } = createScheduling();
    schedule(harness, taskId);
    const id = only(harness).id;
    expect(
      harness.send({ type: 'schedule.fail', scheduleId: id, dueAt: 1, deliveryId: null, detail: 'x' }).events
    ).toHaveLength(0);
    expect(
      harness.send({ type: 'schedule.fail', scheduleId: id, dueAt: null, deliveryId: 'd', detail: 'x' })
        .events
    ).toHaveLength(0);
    expect(
      harness.send({ type: 'schedule.fail', scheduleId: 'nope', dueAt: null, deliveryId: 'd', detail: 'x' })
        .events
    ).toHaveLength(0);
  });
});

describe('writing a schedule from Settings', () => {
  function write(harness: Harness, input: Partial<CommandOf<'schedule.write'>> = {}) {
    return harness.send({
      type: 'schedule.write',
      scheduleId: null,
      name: null,
      text: 'Audit the dependencies.',
      trigger: { kind: 'interval', everyMinutes: 60 },
      target: { kind: 'new_task', repoId: null, priority: 'normal', mode: 'build' },
      source: null,
      enabled: null,
      maxRuns: null,
      timeZone: ZONE,
      ...input,
    });
  }

  test('creates a schedule that starts a task in a repository, made by you', () => {
    const { harness } = createScheduling();
    const repoId = Object.keys(harness.state.repos)[0] ?? '';
    write(harness, { target: { kind: 'new_task', repoId, priority: 'high', mode: 'ask' } });
    const created = only(harness);
    expect(created.createdBy).toEqual({ kind: 'you' });
    expect(created.name).toBe('Audit the dependencies.');
    expect(created.target).toEqual({ kind: 'new_task', repoId, priority: 'high', mode: 'ask' });
    expect(created.nextRunAt).toBe(created.createdAt + 60 * MINUTE);
  });

  test('creates a schedule that messages an open task', () => {
    const { harness, taskId } = createScheduling();
    write(harness, { target: { kind: 'task', taskId }, name: 'Nudge' });
    expect(only(harness)).toMatchObject({ name: 'Nudge', target: { kind: 'task', taskId } });
  });

  test('creates a schedule that messages a task resting after its merge', () => {
    const { harness, taskId } = createScheduling();
    shipAndMerge(harness, taskId);
    write(harness, { target: { kind: 'task', taskId } });
    expect(only(harness).target).toEqual({ kind: 'task', taskId });
  });

  test('changes any schedule, an agent’s too, and keeps its target and creator', () => {
    const { harness, taskId } = createScheduling();
    schedule(harness, taskId);
    const before = only(harness);
    write(harness, { scheduleId: before.id, name: 'Renamed', text: null, trigger: null, target: null });
    expect(only(harness)).toMatchObject({
      name: 'Renamed',
      text: before.text,
      target: before.target,
      createdBy: before.createdBy,
      nextRunAt: before.nextRunAt,
    });
  });

  test('moves a schedule to a new target', () => {
    const { harness, taskId } = createScheduling();
    write(harness);
    write(harness, { scheduleId: only(harness).id, target: { kind: 'task', taskId }, trigger: null });
    expect(only(harness).target).toEqual({ kind: 'task', taskId });
  });

  test('the same values change nothing', () => {
    const { harness } = createScheduling();
    write(harness);
    const id = only(harness).id;
    expect(write(harness, { scheduleId: id }).events).toHaveLength(0);
  });

  test.each<[string, Partial<CommandOf<'schedule.write'>>, string]>([
    ['an unknown time zone', { timeZone: 'Mars/Olympus' }, 'is not a time zone'],
    ['a schedule that does not exist', { scheduleId: 'nope' }, 'No schedule nope'],
    ['a new one without a target', { target: null }, 'Say what it does'],
    [
      'a repository that does not exist',
      { target: { kind: 'new_task', repoId: 'gone', priority: 'normal', mode: 'build' } },
      'No repository gone',
    ],
    ['a task that does not exist', { target: { kind: 'task', taskId: 'nope' } }, 'No task nope'],
    ['no trigger', { trigger: null }, 'Say when it runs'],
  ])('refuses %s', (_name, input, message) => {
    const { harness } = createScheduling();
    expect(() => write(harness, input)).toThrow(message);
    expect(harness.state.schedules).toEqual({});
  });

  test('refuses to message a closed task', () => {
    const { harness, taskId } = createScheduling();
    harness.send({ type: 'task.cancel', taskId });
    expect(() => write(harness, { target: { kind: 'task', taskId } })).toThrow('is closed');
  });

  test('stops at the number of live schedules Shinsa keeps', () => {
    const { harness } = createScheduling();
    for (let index = 0; index < SCHEDULE_LIMITS.live; index += 1) write(harness, { name: `S${index}` });
    expect(() => write(harness)).toThrow('as many schedules as Shinsa keeps');
    const id = Object.keys(harness.state.schedules)[0] ?? '';
    write(harness, { scheduleId: id, name: 'Still editable', trigger: null });
    expect(harness.state.schedules[id]?.name).toBe('Still editable');
  });
});
