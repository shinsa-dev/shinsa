import { describeList } from '../chat/text.ts';
import type { Schedule, ScheduleTrigger } from '../domain/schedules.ts';

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const WORKWEEK = [1, 2, 3, 4, 5];

const WEEKEND = [0, 6];

function isSameDays(days: number[], expected: number[]) {
  return days.length === expected.length && expected.every((day) => days.includes(day));
}

function describeDays(weekdays: number[]) {
  const days = [...new Set(weekdays)].sort((a, b) => a - b);
  if (days.length === 0 || days.length === 7) return 'Every day';
  if (isSameDays(days, WORKWEEK)) return 'Weekdays';
  if (isSameDays(days, WEEKEND)) return 'Weekends';
  return `Every ${describeList(days.map((day) => WEEKDAY_NAMES[day] ?? String(day)))}`;
}

function describeEvery(minutes: number) {
  if (minutes === 1) return 'Every minute';
  if (minutes % 1440 === 0) return minutes === 1440 ? 'Every day' : `Every ${minutes / 1440} days`;
  if (minutes % 60 === 0) return minutes === 60 ? 'Every hour' : `Every ${minutes / 60} hours`;
  return `Every ${minutes} minutes`;
}

export function describeScheduleTrigger(trigger: ScheduleTrigger) {
  switch (trigger.kind) {
    case 'once':
      return 'Once';
    case 'interval':
      return describeEvery(trigger.everyMinutes);
    case 'daily':
      return `${describeDays(trigger.weekdays)} at ${trigger.time}`;
    case 'webhook':
      return 'When its webhook is called';
  }
}

export function describeScheduleTarget(schedule: Schedule, titleOf: (taskId: string) => string | null) {
  if (schedule.target.kind === 'new_task') {
    return schedule.target.mode === 'ask' ? 'Asks a new question' : 'Starts a new task';
  }
  if (schedule.source) return `Watches ${schedule.source.server} and files a task for each new report`;
  const title = titleOf(schedule.target.taskId);
  return title ? `Messages “${title}”` : 'Messages a task';
}
