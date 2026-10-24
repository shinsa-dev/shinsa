import type { ScheduleTargetInput } from '../commands/schedules.ts';
import {
  MINUTE_MS,
  SCHEDULE_LIMITS,
  type ScheduleTrigger,
  SECRET_REF_PATTERN,
  TASK_PRIORITIES,
  type WebhookSignature,
} from '../domain/index.ts';
import { Reader, type Validation } from '../report/validate.ts';
import { parseTimeOfDay, serializeTimeOfDay } from './time.ts';

const WHEN_KEYS = ['in_minutes', 'run_at', 'every_minutes', 'daily_at', 'webhook'] as const;

export interface ScheduleRequest {
  scheduleId: string | null;
  name: string | null;
  text: string | null;
  trigger: ScheduleTrigger | null;
  target: ScheduleTargetInput | null;
  enabled: boolean | null;
  maxRuns: number | null;
  timeZone: string | null;
  secretRef: string | null;
}

function readWeekdays(reader: Reader, value: unknown) {
  return reader.list(value, 'weekdays', SCHEDULE_LIMITS.weekdays).flatMap((day, index) => {
    if (typeof day === 'number' && Number.isInteger(day) && day >= 0 && day <= 6) return [day];
    reader.errors.push(`weekdays[${index}] must be a whole number from 0 (Sunday) to 6 (Saturday).`);
    return [];
  });
}

function readSignature(reader: Reader, value: unknown) {
  if (value === undefined || value === null) return { signature: null, secretRef: null };
  const record = reader.record(value, 'webhook.signature');
  const signature: WebhookSignature = {
    header: reader.text(record.header, 'webhook.signature.header', SCHEDULE_LIMITS.header).toLowerCase(),
    encoding:
      record.encoding === undefined
        ? 'hex'
        : reader.pick(record.encoding, 'webhook.signature.encoding', ['hex', 'base64']),
    prefix: reader.optionalText(record.prefix, 'webhook.signature.prefix', SCHEDULE_LIMITS.prefix) ?? '',
  };
  const secretRef = reader.optionalText(
    record.secret_ref,
    'webhook.signature.secret_ref',
    SCHEDULE_LIMITS.secretRef
  );
  if (secretRef !== null && !SECRET_REF_PATTERN.test(secretRef)) {
    reader.errors.push('webhook.signature.secret_ref must be the secret-ref:… that request_secret returned.');
  }
  return { signature, secretRef };
}

function readWebhook(reader: Reader, value: unknown): TriggerRead {
  const record = value === true ? {} : reader.record(value, 'webhook');
  const { signature, secretRef } = readSignature(reader, record.signature);
  const replayKey = reader.optionalText(record.replay_key, 'webhook.replay_key', SCHEDULE_LIMITS.replayKey);
  return { trigger: { kind: 'webhook', signature, replayKey }, secretRef };
}

function readRunAt(reader: Reader, value: unknown) {
  const text = reader.text(value, 'run_at', SCHEDULE_LIMITS.runAt);
  const at = Date.parse(text);
  if (Number.isNaN(at))
    reader.errors.push(`run_at “${text}” is not a time. Use ISO 8601, such as 2026-01-31T09:00:00-08:00.`);
  return at;
}

function readDaily(reader: Reader, input: Record<string, unknown>): ScheduleTrigger {
  const raw = reader.text(input.daily_at, 'daily_at', SCHEDULE_LIMITS.dailyAt);
  const time = parseTimeOfDay(raw);
  if (!time) reader.errors.push(`daily_at “${raw}” is not a time of day. Use 24-hour HH:MM, such as 09:00.`);
  return {
    kind: 'daily',
    time: time ? serializeTimeOfDay(time) : raw,
    weekdays: readWeekdays(reader, input.weekdays),
  };
}

interface TriggerRead {
  trigger: ScheduleTrigger | null;
  secretRef: string | null;
}

function readTrigger(reader: Reader, input: Record<string, unknown>, now: number): TriggerRead {
  const given = WHEN_KEYS.filter(
    (key) => input[key] !== undefined && input[key] !== null && input[key] !== false
  );
  const [when] = given;
  if (when === undefined) return { trigger: null, secretRef: null };
  if (given.length > 1) {
    reader.errors.push(`Give one of ${WHEN_KEYS.join(', ')}, not several.`);
    return { trigger: null, secretRef: null };
  }
  if (input.weekdays !== undefined && when !== 'daily_at')
    reader.errors.push('weekdays only go with daily_at.');
  switch (when) {
    case 'in_minutes': {
      const minutes = reader.count(input.in_minutes, 'in_minutes', SCHEDULE_LIMITS.maxInMinutes);
      return { trigger: { kind: 'once', at: now + minutes * MINUTE_MS }, secretRef: null };
    }
    case 'run_at':
      return { trigger: { kind: 'once', at: readRunAt(reader, input.run_at) }, secretRef: null };
    case 'every_minutes': {
      const everyMinutes = reader.count(
        input.every_minutes,
        'every_minutes',
        SCHEDULE_LIMITS.maxEveryMinutes
      );
      return { trigger: { kind: 'interval', everyMinutes }, secretRef: null };
    }
    case 'daily_at':
      return { trigger: readDaily(reader, input), secretRef: null };
    case 'webhook':
      return readWebhook(reader, input.webhook);
  }
}

function readTarget(reader: Reader, input: Record<string, unknown>): ScheduleTargetInput | null {
  const newTask = reader.flag(input.new_task, 'new_task');
  const taskId = reader.optionalText(input.task_id, 'task_id', SCHEDULE_LIMITS.reference);
  if (newTask && taskId !== null) reader.errors.push('Give new_task or task_id, not both.');
  if (newTask) {
    return {
      kind: 'new_task',
      priority:
        input.priority === undefined ? 'normal' : reader.pick(input.priority, 'priority', TASK_PRIORITIES),
      mode: reader.flag(input.just_answer, 'just_answer') ? 'ask' : 'build',
    };
  }
  if (taskId !== null) return { kind: 'task', taskId };
  return null;
}

function readEnabled(reader: Reader, value: unknown) {
  if (value === undefined || value === null) return null;
  return reader.flag(value, 'enabled');
}

export function validateScheduleRequest(
  input: Record<string, unknown>,
  now: number
): Validation<ScheduleRequest> {
  const reader = new Reader();
  const { trigger, secretRef } = readTrigger(reader, input, now);
  return reader.result({
    scheduleId: reader.optionalText(input.schedule_id, 'schedule_id', SCHEDULE_LIMITS.reference),
    name: reader.optionalText(input.name, 'name', SCHEDULE_LIMITS.name),
    text: reader.optionalText(input.message, 'message', SCHEDULE_LIMITS.text),
    trigger,
    target: readTarget(reader, input),
    enabled: readEnabled(reader, input.enabled),
    maxRuns: reader.optionalCount(input.max_runs, 'max_runs', SCHEDULE_LIMITS.maxRuns),
    timeZone: reader.optionalText(input.time_zone, 'time_zone', SCHEDULE_LIMITS.timeZone),
    secretRef,
  });
}

export function validateSecretRequest(
  input: Record<string, unknown>
): Validation<{ label: string; reason: string }> {
  const reader = new Reader();
  return reader.result({
    label: reader.text(input.label, 'label', SCHEDULE_LIMITS.secretLabel),
    reason: reader.text(input.reason, 'reason', SCHEDULE_LIMITS.secretReason),
  });
}
