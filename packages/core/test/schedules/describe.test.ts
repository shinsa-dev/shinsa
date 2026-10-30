import { describe, expect, test } from 'bun:test';
import {
  describeScheduleTarget,
  describeScheduleTrigger,
  type Schedule,
  type ScheduleTrigger,
} from '../../src/index.ts';

describe('describing a trigger', () => {
  test.each<[ScheduleTrigger, string]>([
    [{ kind: 'once', at: 0 }, 'Once'],
    [{ kind: 'interval', everyMinutes: 1 }, 'Every minute'],
    [{ kind: 'interval', everyMinutes: 30 }, 'Every 30 minutes'],
    [{ kind: 'interval', everyMinutes: 60 }, 'Every hour'],
    [{ kind: 'interval', everyMinutes: 180 }, 'Every 3 hours'],
    [{ kind: 'interval', everyMinutes: 1440 }, 'Every day'],
    [{ kind: 'interval', everyMinutes: 2880 }, 'Every 2 days'],
    [{ kind: 'daily', time: '09:00', weekdays: [] }, 'Every day at 09:00'],
    [{ kind: 'daily', time: '09:00', weekdays: [0, 1, 2, 3, 4, 5, 6] }, 'Every day at 09:00'],
    [{ kind: 'daily', time: '09:00', weekdays: [5, 4, 3, 2, 1] }, 'Weekdays at 09:00'],
    [{ kind: 'daily', time: '10:30', weekdays: [6, 0] }, 'Weekends at 10:30'],
    [{ kind: 'daily', time: '08:00', weekdays: [1] }, 'Every Monday at 08:00'],
    [{ kind: 'daily', time: '08:00', weekdays: [5, 1, 3] }, 'Every Monday, Wednesday and Friday at 08:00'],
    [{ kind: 'webhook', signature: null, replayKey: null }, 'When its webhook is called'],
  ])('%o reads “%s”', (trigger, text) => {
    expect(describeScheduleTrigger(trigger)).toBe(text);
  });
});

describe('describing a target', () => {
  function withTarget(target: Schedule['target']) {
    return { target } as Schedule;
  }

  test('new tasks and questions', () => {
    expect(
      describeScheduleTarget(
        withTarget({ kind: 'new_task', repoId: null, priority: 'normal', mode: 'build' }),
        () => null
      )
    ).toBe('Starts a new task');
    expect(
      describeScheduleTarget(
        withTarget({ kind: 'new_task', repoId: null, priority: 'normal', mode: 'ask' }),
        () => null
      )
    ).toBe('Asks a new question');
  });

  test('a message names its task when it is known', () => {
    expect(describeScheduleTarget(withTarget({ kind: 'task', taskId: 't' }), () => 'Fix it')).toBe(
      'Messages “Fix it”'
    );
    expect(describeScheduleTarget(withTarget({ kind: 'task', taskId: 't' }), () => null)).toBe(
      'Messages a task'
    );
  });

  test('a watch names the integration it watches, never the home it reads in', () => {
    const reading = {
      target: { kind: 'task', taskId: 't' },
      source: { projectId: 'p', server: 'slack' },
    } as Schedule;
    expect(describeScheduleTarget(reading, () => 'Read #feedback')).toBe(
      'Watches slack and files a task for each new report'
    );
  });
});
