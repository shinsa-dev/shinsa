import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  canResume,
  copyWebhookUrl,
  describeNextRun,
  describeOpenTask,
  describeRemoval,
  describeScheduleSummary,
  describeScheduleWhat,
  describeScheduleWhen,
  removeSchedule,
  requestWebhook,
  resolveScheduleIcon,
  resolveScheduleStatus,
  resolveScheduleTaskId,
  updateScheduleEnabled,
} from '@/lib/schedules.ts';
import { spyOnCommands, spyOnToasts } from '../support/commands.ts';
import { startFakeOnboarding } from '../support/onboarding.ts';
import { createSchedule } from '../support/schedules.ts';
import { createShinsaState, createTask, NOW } from '../support/state.ts';

const HOUR = 60 * 60_000;

let spies: ReturnType<typeof spyOnCommands>;

let toasts: ReturnType<typeof spyOnToasts>;

beforeEach(() => {
  spies = spyOnCommands();
  toasts = spyOnToasts();
});

afterEach(() => {
  spies.restore();
  toasts.restore();
});

const HOOK = createSchedule({
  id: 's-hook',
  name: 'Review pushes',
  trigger: { kind: 'webhook', signature: null, replayKey: null },
  nextRunAt: null,
});

describe('describing a schedule', () => {
  it('names when it runs and what it does, with an icon per kind', () => {
    const state = createShinsaState({ tasks: [createTask({ id: 't-1', title: 'Nightly audit' })] });
    const message = createSchedule({ id: 's-1', target: { kind: 'task', taskId: 't-1' } });
    expect(describeScheduleWhen(message)).toBe('Every hour');
    expect(describeScheduleWhat(state, message)).toBe('Messages “Nightly audit”');
    expect(describeScheduleWhat(state, createSchedule({ id: 's-2' }))).toBe('Starts a new task');
    expect(describeScheduleSummary(state, message)).toBe('Schedule · Messages “Nightly audit” · every hour');
    expect(
      describeScheduleSummary(
        state,
        createSchedule({ id: 'w', trigger: { kind: 'webhook', signature: null, replayKey: null } })
      )
    ).toBe('Trigger · Starts a new task · when its webhook is called');
    expect(describeOpenTask(message)).toBe('Open the task');
    expect(describeOpenTask({ ...message, source: { projectId: 'p', server: 'slack' } })).toBe(
      'Open the watch'
    );
    expect(
      [
        createSchedule({ id: 'a', trigger: { kind: 'once', at: NOW } }),
        createSchedule({ id: 'b' }),
        createSchedule({ id: 'c', trigger: { kind: 'daily', time: '09:00', weekdays: [] } }),
        HOOK,
      ].map(resolveScheduleIcon)
    ).toEqual(['IconHourglass', 'IconArrowsRepeat', 'IconClock', 'IconGlobe']);
  });

  it('a watch shows its type, the integration it watches and the tasks it filed', () => {
    const report = (scheduleId: string) => ({
      scheduleId,
      server: 'slack',
      reportId: null,
      link: 'https://example.slack.com/p1',
      author: null,
      postedAt: null,
      text: 'Broken.',
    });
    const state = createShinsaState({
      tasks: [
        createTask({ id: 'reader', title: 'Read #feedback' }),
        createTask({ id: 'f-1', sourceReport: report('s-read') }),
        createTask({ id: 'f-2', sourceReport: report('s-read') }),
        createTask({ id: 'f-3', sourceReport: report('s-other') }),
      ],
    });
    const reading = createSchedule({
      id: 's-read',
      target: { kind: 'task', taskId: 'reader' },
      source: { projectId: 'p', server: 'slack' },
    });
    expect(describeScheduleSummary(state, reading)).toBe('Watch · slack · every hour · 2 tasks filed');
    const fresh = createSchedule({
      id: 's-fresh',
      target: { kind: 'task', taskId: 'reader' },
      source: { projectId: 'p', server: 'slack' },
    });
    expect(describeScheduleSummary(state, fresh)).toBe('Watch · slack · every hour · nothing filed yet');
    const one = { ...state, tasks: { ...state.tasks, 'f-2': { ...createTask({ id: 'f-2' }) } } };
    expect(describeScheduleSummary(one, reading)).toBe('Watch · slack · every hour · 1 task filed');
  });

  it('reads a daily time on the clock the rest of the app uses', () => {
    const daily = createSchedule({
      id: 'd',
      trigger: { kind: 'daily', time: '09:05', weekdays: [1, 2, 3, 4, 5] },
    });
    expect(describeScheduleWhen(daily)).toBe('Weekdays at 9:05 AM');
    const broken = createSchedule({ id: 'e', trigger: { kind: 'daily', time: 'soon', weekdays: [] } });
    expect(describeScheduleWhen(broken)).toBe('Every day at soon');
  });

  it('says why it is not running, that its last run failed, or when it runs next', () => {
    expect(
      resolveScheduleStatus(createSchedule({ id: 'a', stopped: 'target_gone', enabled: false }))
    ).toEqual({
      label: 'Its task is gone',
      tone: 'neutral',
      at: null,
    });
    expect(
      resolveScheduleStatus(createSchedule({ id: 'b', stopped: 'finished', enabled: false }))?.label
    ).toBe('Finished');
    expect(resolveScheduleStatus(createSchedule({ id: 'c', enabled: false }))?.label).toBe('Paused');
    const failed = createSchedule({
      id: 'd',
      runs: [{ at: NOW, outcome: 'failed', taskId: null, deliveryId: null, detail: 'No task' }],
    });
    expect(resolveScheduleStatus(failed)).toEqual({ label: 'Last run failed', tone: 'red', at: null });
    expect(resolveScheduleStatus(HOOK)).toBeNull();
    expect(resolveScheduleStatus(createSchedule({ id: 'e' }))).toEqual({
      label: 'Next run',
      tone: 'neutral',
      at: NOW + HOUR,
    });
  });

  it('gives the next run’s time today, and the day too when it is later', () => {
    const today = new Date(NOW);
    today.setHours(9, 0, 0, 0);
    const noon = new Date(NOW);
    noon.setHours(12, 0, 0, 0);
    expect(describeNextRun(today.getTime(), noon.getTime())).toBe('Next at 9:00 AM');
    expect(describeNextRun(today.getTime() + 24 * HOUR, noon.getTime())).toMatch(/^Next at \w{3} 9:00 AM$/);
  });

  it('can resume a paused schedule but not a finished one', () => {
    expect(canResume(createSchedule({ id: 'a', enabled: false }))).toBe(true);
    expect(canResume(createSchedule({ id: 'b' }))).toBe(false);
    expect(canResume(createSchedule({ id: 'c', enabled: false, stopped: 'finished' }))).toBe(false);
  });

  it('points at the task it messages, or the last task it started', () => {
    expect(resolveScheduleTaskId(createSchedule({ id: 'a', target: { kind: 'task', taskId: 't-1' } }))).toBe(
      't-1'
    );
    expect(resolveScheduleTaskId(createSchedule({ id: 'b', lastTaskId: 't-9' }))).toBe('t-9');
    expect(resolveScheduleTaskId(createSchedule({ id: 'c' }))).toBeNull();
  });

  it('warns that deleting a webhook schedule stops its URL', () => {
    expect(describeRemoval(createSchedule({ id: 'a', name: 'Audit' }))).toEqual({
      title: 'Delete “Audit”?',
      body: 'It stops running. Tasks it started stay.',
    });
    expect(describeRemoval(HOOK).body).toBe(
      'It stops running, and its webhook URL stops working. Tasks it started stay.'
    );
  });
});

describe('changing a schedule', () => {
  it('pauses, resumes and deletes through commands', async () => {
    const schedule = createSchedule({ id: 's-1', name: 'Audit' });
    await updateScheduleEnabled(schedule, false);
    await updateScheduleEnabled(schedule, true);
    await removeSchedule(schedule);
    expect(spies.sent.mock.calls).toEqual([
      [{ type: 'schedule.enable', scheduleId: 's-1', enabled: false }, '“Audit” is paused.'],
      [{ type: 'schedule.enable', scheduleId: 's-1', enabled: true }, '“Audit” runs again.'],
      [{ type: 'schedule.remove', scheduleId: 's-1' }, 'Deleted “Audit”.'],
    ] as never);
  });

  it('copies the webhook URL the server hands out', async () => {
    const fake = startFakeOnboarding({
      'GET /api/schedules/s-hook/webhook': {
        answer: { url: 'http://localhost/api/hooks/s-hook/t', hasSecret: false },
      },
    });
    expect(await requestWebhook(HOOK)).toEqual({
      url: 'http://localhost/api/hooks/s-hook/t',
      hasSecret: false,
    });
    await copyWebhookUrl(HOOK);
    expect(spies.copied).toHaveBeenCalledWith('http://localhost/api/hooks/s-hook/t');
    fake.stop();
  });

  it('says what went wrong when the server will not give the URL', async () => {
    const fake = startFakeOnboarding({
      'GET /api/schedules/s-hook/webhook': {
        answer: { error: { message: 'This schedule has no webhook.' } },
        status: 400,
      },
    });
    await copyWebhookUrl(HOOK);
    expect(toasts.error).toHaveBeenCalledWith('This schedule has no webhook.');
    expect(spies.copied).not.toHaveBeenCalled();
    fake.stop();
  });
});
