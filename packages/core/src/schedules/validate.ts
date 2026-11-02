import { Schema } from 'effect';
import type { ScheduleTargetInput } from '../commands/schedules.ts';
import {
  MINUTE_MS,
  SCHEDULE_LIMITS,
  type ScheduleTrigger,
  SECRET_REF_PATTERN,
  TASK_PRIORITIES,
  type WebhookSignature,
} from '../domain/index.ts';
import {
  CountUpTo,
  Flag,
  HandOverReader,
  HandOverRecord,
  Items,
  OptionalText,
  OrAbsent,
  OrOmitted,
  OneOf,
  Required,
  type Validation,
  WholeNumber,
} from '../report/reading.ts';
import { parseTimeOfDay, serializeTimeOfDay } from './time.ts';

const WHEN_KEYS = ['in_minutes', 'run_at', 'every_minutes', 'daily_at', 'webhook'] as const;

export interface ScheduleRequest {
  scheduleId: string | null;
  name: string | null;
  text: string | null;
  trigger: ScheduleTrigger | null;
  target: ScheduleTargetInput | null;
  source: string | null;
  enabled: boolean | null;
  maxRuns: number | null;
  timeZone: string | null;
  secretRef: string | null;
}

const Weekdays = Items(
  WholeNumber(
    '{path} must be a whole number from 0 (Sunday) to 6 (Saturday).',
    (day) => day >= 0 && day <= 6,
    0
  ),
  SCHEDULE_LIMITS.weekdays
);

const SIGNATURE_ENCODINGS: readonly [WebhookSignature['encoding'], ...WebhookSignature['encoding'][]] = [
  'hex',
  'base64',
];

const Signature = HandOverRecord({
  header: Required(SCHEDULE_LIMITS.header),
  encoding: OrOmitted(OneOf(SIGNATURE_ENCODINGS)),
  prefix: OptionalText(SCHEDULE_LIMITS.prefix),
  secret_ref: OptionalText(SCHEDULE_LIMITS.secretRef),
}).check(
  Schema.makeFilter(
    ({ secret_ref: secretRef }: { secret_ref: string | null }) =>
      secretRef === null ||
      SECRET_REF_PATTERN.test(secretRef) ||
      '{path}.secret_ref must be the secret-ref:… that request_secret returned.'
  )
);

const Webhook = HandOverRecord({
  signature: OrAbsent(Signature),
  replay_key: OptionalText(SCHEDULE_LIMITS.replayKey),
});

function readWebhook(reader: HandOverReader, value: unknown): TriggerRead {
  const webhook = reader.read(Webhook, value === true ? {} : value, ['webhook']);
  const { signature } = webhook;
  return {
    trigger: {
      kind: 'webhook',
      signature:
        signature === null
          ? null
          : {
              header: signature.header.toLowerCase(),
              encoding: signature.encoding ?? 'hex',
              prefix: signature.prefix ?? '',
            },
      replayKey: webhook.replay_key,
    },
    secretRef: signature?.secret_ref ?? null,
  };
}

const RunAt = HandOverRecord({ run_at: Required(SCHEDULE_LIMITS.runAt) }).check(
  Schema.makeFilter(
    ({ run_at: text }: { run_at: string }) =>
      !Number.isNaN(Date.parse(text)) ||
      `run_at “${text}” is not a time. Use ISO 8601, such as 2026-01-31T09:00:00-08:00.`,
    { after: 'run_at' }
  )
);

const DailyAt = HandOverRecord({ daily_at: Required(SCHEDULE_LIMITS.dailyAt), weekdays: Weekdays }).check(
  Schema.makeFilter(
    ({ daily_at: text }: { daily_at: string }) =>
      parseTimeOfDay(text) !== null ||
      `daily_at “${text}” is not a time of day. Use 24-hour HH:MM, such as 09:00.`,
    { after: 'daily_at' }
  )
);

function readDaily(reader: HandOverReader, input: Record<string, unknown>): ScheduleTrigger {
  const { daily_at: raw, weekdays } = reader.read(DailyAt, input, []);
  const time = parseTimeOfDay(raw);
  return { kind: 'daily', time: time ? serializeTimeOfDay(time) : raw, weekdays };
}

interface TriggerRead {
  trigger: ScheduleTrigger | null;
  secretRef: string | null;
}

const InMinutes = CountUpTo(SCHEDULE_LIMITS.maxInMinutes);

const EveryMinutes = CountUpTo(SCHEDULE_LIMITS.maxEveryMinutes);

function readTrigger(reader: HandOverReader, input: Record<string, unknown>, now: number): TriggerRead {
  const given = WHEN_KEYS.filter(
    (key) => input[key] !== undefined && input[key] !== null && input[key] !== false
  );
  const [when] = given;
  if (when === undefined) return { trigger: null, secretRef: null };
  if (given.length > 1) {
    reader.refuse(`Give one of ${WHEN_KEYS.join(', ')}, not several.`);
    return { trigger: null, secretRef: null };
  }
  if (input.weekdays !== undefined && when !== 'daily_at') reader.refuse('weekdays only go with daily_at.');
  switch (when) {
    case 'in_minutes': {
      const minutes = reader.read(InMinutes, input.in_minutes, ['in_minutes']);
      return { trigger: { kind: 'once', at: now + minutes * MINUTE_MS }, secretRef: null };
    }
    case 'run_at': {
      const { run_at: text } = reader.read(RunAt, input, []);
      return { trigger: { kind: 'once', at: Date.parse(text) }, secretRef: null };
    }
    case 'every_minutes': {
      const everyMinutes = reader.read(EveryMinutes, input.every_minutes, ['every_minutes']);
      return { trigger: { kind: 'interval', everyMinutes }, secretRef: null };
    }
    case 'daily_at':
      return { trigger: readDaily(reader, input), secretRef: null };
    case 'webhook':
      return readWebhook(reader, input.webhook);
  }
}

const TargetChoice = HandOverRecord({
  new_task: Flag,
  task_id: OptionalText(SCHEDULE_LIMITS.reference),
}).check(
  Schema.makeFilter(
    ({ new_task: newTask, task_id: taskId }: { new_task: boolean; task_id: string | null }) =>
      !newTask || taskId === null || 'Give new_task or task_id, not both.'
  )
);

const NewTaskTarget = HandOverRecord({
  priority: OrOmitted(OneOf(TASK_PRIORITIES)),
  just_answer: Flag,
});

function readTarget(reader: HandOverReader, input: Record<string, unknown>): ScheduleTargetInput | null {
  const { new_task: newTask, task_id: taskId } = reader.read(TargetChoice, input, []);
  if (newTask) {
    const target = reader.read(NewTaskTarget, input, []);
    return {
      kind: 'new_task',
      priority: target.priority ?? 'normal',
      mode: target.just_answer ? 'ask' : 'build',
    };
  }
  if (taskId !== null) return { kind: 'task', taskId };
  return null;
}

const ScheduleNaming = HandOverRecord({
  schedule_id: OptionalText(SCHEDULE_LIMITS.reference),
  name: OptionalText(SCHEDULE_LIMITS.name),
  message: OptionalText(SCHEDULE_LIMITS.text),
});

const ScheduleOptions = HandOverRecord({
  source: OptionalText(SCHEDULE_LIMITS.reference),
  enabled: OrAbsent(Flag),
  max_runs: OrAbsent(CountUpTo(SCHEDULE_LIMITS.maxRuns)),
  time_zone: OptionalText(SCHEDULE_LIMITS.timeZone),
});

export function validateScheduleRequest(
  input: Record<string, unknown>,
  now: number
): Validation<ScheduleRequest> {
  const reader = new HandOverReader();
  const { trigger, secretRef } = readTrigger(reader, input, now);
  const naming = reader.read(ScheduleNaming, input, []);
  const target = readTarget(reader, input);
  const options = reader.read(ScheduleOptions, input, []);
  return reader.result({
    scheduleId: naming.schedule_id,
    name: naming.name,
    text: naming.message,
    trigger,
    target,
    source: options.source,
    enabled: options.enabled,
    maxRuns: options.max_runs,
    timeZone: options.time_zone,
    secretRef,
  });
}

const ReadReportInput = HandOverRecord({
  summary: Required(SCHEDULE_LIMITS.readSummary),
  reached: OrAbsent(Flag),
  live: OrAbsent(Flag),
});

export function validateReadReport(
  input: Record<string, unknown>
): Validation<{ summary: string; reached: boolean; live: boolean | null }> {
  const reader = new HandOverReader();
  const report = reader.read(ReadReportInput, input, []);
  return reader.result({ summary: report.summary, reached: report.reached ?? true, live: report.live });
}

export interface ReportFilingRequest {
  title: string;
  request: string;
  reportId: string | null;
  link: string | null;
  author: string | null;
  postedAt: string | null;
  text: string;
  forkFrom: string | null;
  repository: string | null;
}

const ReportFilingInput = HandOverRecord({
  report_id: OptionalText(SCHEDULE_LIMITS.reportId),
  link: OptionalText(SCHEDULE_LIMITS.reportLink),
  title: Required(SCHEDULE_LIMITS.reportTitle),
  request: Required(SCHEDULE_LIMITS.reportRequest),
  author: OptionalText(SCHEDULE_LIMITS.reportAuthor),
  posted_at: OptionalText(SCHEDULE_LIMITS.reportPostedAt),
  text: Required(SCHEDULE_LIMITS.reportText),
  fork_from: OptionalText(SCHEDULE_LIMITS.reference),
  repository: OptionalText(SCHEDULE_LIMITS.reference),
}).check(
  Schema.makeFilter(
    ({ report_id: reportId, link }: { report_id: string | null; link: string | null }) =>
      reportId !== null ||
      link !== null ||
      'Give the report’s report_id or link in the source, so Shinsa never files it twice.',
    { after: 'link' }
  )
);

export function validateReportFiling(input: Record<string, unknown>): Validation<ReportFilingRequest> {
  const reader = new HandOverReader();
  const filing = reader.read(ReportFilingInput, input, []);
  return reader.result({
    title: filing.title,
    request: filing.request,
    reportId: filing.report_id,
    link: filing.link,
    author: filing.author,
    postedAt: filing.posted_at,
    text: filing.text,
    forkFrom: filing.fork_from,
    repository: filing.repository,
  });
}

const SecretRequestInput = HandOverRecord({
  label: Required(SCHEDULE_LIMITS.secretLabel),
  reason: Required(SCHEDULE_LIMITS.secretReason),
});

export function validateSecretRequest(
  input: Record<string, unknown>
): Validation<{ label: string; reason: string }> {
  const reader = new HandOverReader();
  return reader.result(reader.read(SecretRequestInput, input, []));
}
