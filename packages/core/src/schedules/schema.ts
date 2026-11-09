import { Option, Schema } from 'effect';
import {
  SCHEDULE_LIMITS,
  SECRET_REF_PATTERN,
  TASK_PRIORITIES,
  type WebhookSignature,
} from '../domain/index.ts';
import {
  CountUpTo,
  Flag,
  HandOverRecord,
  Items,
  OneOf,
  OptionalText,
  OrAbsent,
  OrOmitted,
  Required,
  WholeNumber,
} from '../report/reading.ts';
import { parseTimeOfDay } from './time.ts';

export const WHEN_KEYS = ['in_minutes', 'run_at', 'every_minutes', 'daily_at', 'webhook'] as const;

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

const SIGNATURE_KEYS = ['header', 'encoding', 'prefix', 'secret_ref'];

const WEBHOOK_KEYS = ['signature', 'replay_key'];

const Signature = HandOverRecord({
  header: Required(SCHEDULE_LIMITS.header),
  encoding: OrOmitted(OneOf(SIGNATURE_ENCODINGS)),
  prefix: OptionalText(SCHEDULE_LIMITS.prefix),
  secret_ref: OptionalText(SCHEDULE_LIMITS.secretRef),
}).check(
  Schema.makeFilter(
    (fields: { readonly [key: string]: unknown }) => {
      const unknown = Object.keys(fields).filter((key) => !SIGNATURE_KEYS.includes(key));
      return (
        unknown.length === 0 ||
        `{path} has no ${unknown.join(', ')}. Its fields are ${SIGNATURE_KEYS.join(', ')}.`
      );
    },
    { raw: true }
  ),
  Schema.makeFilter(
    ({ secret_ref: secretRef }: { secret_ref: string | null }) =>
      secretRef === null ||
      SECRET_REF_PATTERN.test(secretRef) ||
      '{path}.secret_ref must be the secret-ref:… that request_secret returned.'
  )
);

export const Webhook = HandOverRecord({
  signature: OrAbsent(Signature),
  replay_key: OptionalText(SCHEDULE_LIMITS.replayKey),
}).check(
  Schema.makeFilter(
    (fields: { readonly [key: string]: unknown }) => {
      const misplaced = Object.keys(fields).filter((key) => SIGNATURE_KEYS.includes(key));
      return (
        misplaced.length === 0 ||
        `${misplaced.join(', ')} go under webhook.signature, not on webhook itself: webhook: { signature: { header, encoding, prefix, secret_ref } }.`
      );
    },
    { raw: true }
  ),
  Schema.makeFilter(
    (fields: { readonly [key: string]: unknown }) => {
      const unknown = Object.keys(fields).filter(
        (key) => !WEBHOOK_KEYS.includes(key) && !SIGNATURE_KEYS.includes(key)
      );
      return (
        unknown.length === 0 ||
        `{path} has no ${unknown.join(', ')}. Its fields are ${WEBHOOK_KEYS.join(', ')}.`
      );
    },
    { raw: true }
  )
);

export const RunAt = HandOverRecord({ run_at: Required(SCHEDULE_LIMITS.runAt) }).check(
  Schema.makeFilter(
    ({ run_at: text }: { run_at: string }) =>
      !Number.isNaN(Date.parse(text)) ||
      `run_at “${text}” is not a time. Use ISO 8601, such as 2026-01-31T09:00:00-08:00.`,
    { after: 'run_at' }
  )
);

export const DailyAt = HandOverRecord({
  daily_at: Required(SCHEDULE_LIMITS.dailyAt),
  weekdays: Weekdays,
}).check(
  Schema.makeFilter(
    ({ daily_at: text }: { daily_at: string }) =>
      Option.isSome(parseTimeOfDay(text)) ||
      `daily_at “${text}” is not a time of day. Use 24-hour HH:MM, such as 09:00.`,
    { after: 'daily_at' }
  )
);

export const InMinutes = CountUpTo(SCHEDULE_LIMITS.maxInMinutes);

export const EveryMinutes = CountUpTo(SCHEDULE_LIMITS.maxEveryMinutes);

export const TargetChoice = HandOverRecord({
  new_task: Flag,
  task_id: OptionalText(SCHEDULE_LIMITS.reference),
  repository: OrAbsent(Schema.Unknown),
}).check(
  Schema.makeFilter(
    ({ new_task: newTask, task_id: taskId }: { new_task: boolean; task_id: string | null }) =>
      !newTask || taskId === null || 'Give new_task or task_id, not both.'
  ),
  Schema.makeFilter(
    ({ new_task: newTask, repository }: { new_task: boolean; repository: unknown }) =>
      newTask ||
      repository === null ||
      'repository only goes with new_task: it is where each new task starts.'
  )
);

export const NewTaskTarget = HandOverRecord({
  priority: OrOmitted(OneOf(TASK_PRIORITIES)),
  just_answer: Flag,
});

export const ScheduleNaming = HandOverRecord({
  schedule_id: OptionalText(SCHEDULE_LIMITS.reference),
  name: OptionalText(SCHEDULE_LIMITS.name),
  message: OptionalText(SCHEDULE_LIMITS.text),
});

export const ScheduleOptions = HandOverRecord({
  source: OptionalText(SCHEDULE_LIMITS.reference),
  enabled: OrAbsent(Flag),
  max_runs: OrAbsent(CountUpTo(SCHEDULE_LIMITS.maxRuns)),
  time_zone: OptionalText(SCHEDULE_LIMITS.timeZone),
  repository: OptionalText(SCHEDULE_LIMITS.reference),
});

export const ReadReportInput = HandOverRecord({
  summary: Required(SCHEDULE_LIMITS.readSummary),
  reached: OrAbsent(Flag),
  live: OrAbsent(Flag),
});

export const ReportFilingInput = HandOverRecord({
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

export const SecretRequestInput = HandOverRecord({
  label: Required(SCHEDULE_LIMITS.secretLabel),
  reason: Required(SCHEDULE_LIMITS.secretReason),
});
