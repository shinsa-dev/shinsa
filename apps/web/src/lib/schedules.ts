import {
  describeCount,
  describeScheduleTarget,
  describeScheduleTrigger,
  lowerFirst,
  parseTimeOfDay,
  type Schedule,
  type ShinsaState,
} from '@shinsa/core';
import type { IconName } from '@shinsa/ui/components/icon';
import { Option } from 'effect';
import { sendCommandWithToast } from '@/lib/connection/commands.ts';
import { requestWebhook as requestScheduleWebhook, requestWebhookCopy } from '@/lib/connection/schedules.ts';
import { formatClock, formatMoment } from '@/lib/format/time.ts';
import type { Tone } from '@/lib/format/tone.ts';

interface ScheduleStatus {
  label: string;
  tone: Tone;
  at: number | null;
}

const TRIGGER_ICON: Record<Schedule['trigger']['kind'], IconName> = {
  once: 'IconHourglass',
  interval: 'IconArrowsRepeat',
  daily: 'IconClock',
  webhook: 'IconGlobe',
  slack: 'IconSlack',
};

export function resolveScheduleIcon(schedule: Schedule): IconName {
  return TRIGGER_ICON[schedule.trigger.kind];
}

export function describeScheduleWhen(schedule: Schedule) {
  const { trigger } = schedule;
  const described = describeScheduleTrigger(trigger);
  if (trigger.kind !== 'daily') return described;
  const parsed = parseTimeOfDay(trigger.time);
  if (Option.isNone(parsed)) return described;
  const time = parsed.value;
  const at = new Date();
  at.setHours(time.hour, time.minute, 0, 0);
  return described.replace(trigger.time, formatClock(at.getTime()));
}

export function describeScheduleWhat(state: ShinsaState, schedule: Schedule) {
  return describeScheduleTarget(schedule, (taskId) => state.tasks[taskId]?.title ?? null);
}

function countFiledTasks(state: ShinsaState, schedule: Schedule) {
  return Object.values(state.tasks).filter((task) => task.sourceReport?.scheduleId === schedule.id).length;
}

function describeFiled(count: number) {
  return count === 0 ? 'nothing filed yet' : `${describeCount(count, 'task', 'tasks')} filed`;
}

export type AutomationType = 'Watch' | 'Trigger' | 'Schedule';

export const AUTOMATION_TYPE_LOOK: Record<AutomationType, { icon: IconName; tone: Tone; hint: string }> = {
  Watch: { icon: 'IconRadar', tone: 'purple', hint: 'Reads an integration and files a task per new report' },
  Schedule: { icon: 'IconCalendarClock', tone: 'blue', hint: 'Starts or messages a task at a time' },
  Trigger: { icon: 'IconGlobe', tone: 'orange', hint: 'Starts a task when its webhook is called' },
};

const SLACK_TRIGGER_LOOK: (typeof AUTOMATION_TYPE_LOOK)[AutomationType] = {
  icon: 'IconSlack',
  tone: 'orange',
  hint: 'Starts or messages a task for each new message in its Slack channel',
};

export function resolveAutomationType(schedule: Schedule): AutomationType {
  if (schedule.source) return 'Watch';
  return schedule.trigger.kind === 'webhook' || schedule.trigger.kind === 'slack' ? 'Trigger' : 'Schedule';
}

export function resolveAutomationLook(schedule: Schedule) {
  if (schedule.trigger.kind === 'slack' && !schedule.source) return SLACK_TRIGGER_LOOK;
  return AUTOMATION_TYPE_LOOK[resolveAutomationType(schedule)];
}

export function describeScheduleWhere(schedule: Schedule) {
  return schedule.trigger.kind === 'slack' ? `${schedule.trigger.teamName} on Slack` : null;
}

export function describeScheduleSummary(state: ShinsaState, schedule: Schedule) {
  const type = resolveAutomationType(schedule);
  const when = lowerFirst(describeScheduleWhen(schedule));
  if (schedule.source) {
    return `${type} · ${schedule.source.server} · ${when} · ${describeFiled(countFiledTasks(state, schedule))}`;
  }
  return `${type} · ${describeScheduleWhat(state, schedule)} · ${when}`;
}

export function describeOpenTask(schedule: Schedule) {
  return schedule.source ? 'Open the watch' : 'Open the task';
}

export function resolveScheduleStatus(schedule: Schedule): ScheduleStatus | null {
  if (schedule.stopped === 'target_gone') return { label: 'Its task is gone', tone: 'neutral', at: null };
  if (schedule.stopped === 'finished') return { label: 'Finished', tone: 'neutral', at: null };
  if (!schedule.enabled) return { label: 'Paused', tone: 'neutral', at: null };
  const last = schedule.runs.at(-1);
  if (last?.outcome === 'failed') return { label: 'Last run failed', tone: 'red', at: null };
  if (schedule.nextRunAt === null) return null;
  return { label: 'Next run', tone: 'neutral', at: schedule.nextRunAt };
}

export function describeNextRun(at: number, now: number) {
  return `Next at ${formatMoment(at, now)}`;
}

export function canResume(schedule: Schedule) {
  return schedule.stopped === null && !schedule.enabled;
}

export function updateScheduleEnabled(schedule: Schedule, enabled: boolean) {
  return sendCommandWithToast(
    { type: 'schedule.enable', scheduleId: schedule.id, enabled },
    enabled ? `“${schedule.name}” runs again.` : `“${schedule.name}” is paused.`
  );
}

export function removeSchedule(schedule: Schedule) {
  return sendCommandWithToast(
    { type: 'schedule.remove', scheduleId: schedule.id },
    `Deleted “${schedule.name}”.`
  );
}

export function requestWebhook(schedule: Schedule) {
  return requestScheduleWebhook(schedule.id);
}

export function resolveScheduleTaskId(schedule: Schedule) {
  return schedule.target.kind === 'task' ? schedule.target.taskId : schedule.lastTaskId;
}

export function describeRemoval(schedule: Schedule) {
  return {
    title: `Delete “${schedule.name}”?`,
    body:
      schedule.trigger.kind === 'webhook'
        ? 'It stops running, and its webhook URL stops working. Tasks it started stay.'
        : 'It stops running. Tasks it started stay.',
  };
}

export function copyWebhookUrl(schedule: Schedule) {
  return requestWebhookCopy(() => requestWebhook(schedule));
}
