import { identity, Schema, SchemaTransformation } from 'effect';
import {
  ByDefault,
  Choice,
  Count,
  FIELD_MESSAGES,
  ID_LIMIT,
  Id,
  NullByDefault,
  NumberOf,
  resolveChoiceMessage,
  Strict,
  Tagged,
  Text,
  Time,
} from './fields.ts';
import { TASK_PRIORITIES } from './stages.ts';
import { DAY_MS, MINUTE_MS } from './time.ts';
import { TASK_MODES, type Task } from './types.ts';

export const WEBHOOK_ENCODINGS = ['hex', 'base64'] as const;

export type WebhookEncoding = (typeof WEBHOOK_ENCODINGS)[number];

const WEEKDAYS_MESSAGE = 'weekdays must be a list of up to 7 days.';

export const WebhookSignature = Strict(
  {
    header: Id(),
    encoding: ByDefault(
      Choice(WEBHOOK_ENCODINGS),
      resolveChoiceMessage(WEBHOOK_ENCODINGS),
      () => 'hex' as const
    ),
    prefix: NullByDefault(Text(ID_LIMIT), FIELD_MESSAGES.text).pipe(
      Schema.decodeTo(
        Schema.String,
        SchemaTransformation.transform({ decode: (prefix) => prefix ?? '', encode: identity })
      )
    ),
  },
  'A signature',
  '{key}'
);

export type WebhookSignature = typeof WebhookSignature.Type;

export const SCHEDULE_TRIGGER_KINDS = ['once', 'interval', 'daily', 'webhook'] as const;

export const ScheduleTrigger = Tagged('kind', SCHEDULE_TRIGGER_KINDS, [
  Schema.Struct({ kind: Schema.Literal('once'), at: Time }),
  Schema.Struct({ kind: Schema.Literal('interval'), everyMinutes: Count }),
  Schema.Struct({
    kind: Schema.Literal('daily'),
    time: Id(),
    weekdays: Schema.Array(Schema.Unknown)
      .annotate({ message: WEEKDAYS_MESSAGE })
      .check(Schema.isMaxLength(7, { message: WEEKDAYS_MESSAGE }))
      .pipe(
        Schema.decodeTo(
          Schema.mutable(Schema.Array(NumberOf('day must be a whole number.', Number.isInteger))),
          SchemaTransformation.passthrough({ strict: false })
        )
      )
      .annotateKey({ messageMissingKey: WEEKDAYS_MESSAGE }),
  }),
  Schema.Struct({
    kind: Schema.Literal('webhook'),
    signature: NullByDefault(WebhookSignature, FIELD_MESSAGES.object),
    replayKey: NullByDefault(Text(ID_LIMIT), FIELD_MESSAGES.text),
  }),
]);

export type ScheduleTrigger = typeof ScheduleTrigger.Type;

export type ScheduleTriggerKind = ScheduleTrigger['kind'];

export const ScheduleTarget = Tagged(
  'kind',
  ['new_task', 'task'],
  [
    Schema.Struct({
      kind: Schema.Literal('new_task'),
      repoId: NullByDefault(Id(), FIELD_MESSAGES.text),
      priority: ByDefault(
        Choice(TASK_PRIORITIES),
        resolveChoiceMessage(TASK_PRIORITIES),
        () => 'normal' as const
      ),
      mode: ByDefault(Choice(TASK_MODES), resolveChoiceMessage(TASK_MODES), () => 'build' as const),
    }),
    Schema.Struct({ kind: Schema.Literal('task'), taskId: Id() }),
  ]
);

export type ScheduleTarget = typeof ScheduleTarget.Type;

export const ScheduleSource = Strict({ projectId: Id(), server: Text(ID_LIMIT) }, 'A source', '{key}');

export type ScheduleSource = typeof ScheduleSource.Type;

export interface SourceReport {
  scheduleId: string | null;
  watchdogId: string | null;
  server: string;
  reportId: string | null;
  link: string | null;
  author: string | null;
  postedAt: string | null;
  text: string;
}

export type ScheduleRunOutcome = 'sent' | 'skipped' | 'failed';

export interface ScheduleRun {
  at: number;
  outcome: ScheduleRunOutcome;
  taskId: string | null;
  deliveryId: string | null;
  detail: string | null;
}

export type ScheduleCreator = { kind: 'you' } | { kind: 'agent'; taskId: string; runId: string };

export type ScheduleStop = 'finished' | 'target_gone';

export interface Schedule {
  id: string;
  name: string;
  text: string;
  trigger: ScheduleTrigger;
  target: ScheduleTarget;
  source: ScheduleSource | null;
  timeZone: string;
  enabled: boolean;
  nextRunAt: number | null;
  runCount: number;
  maxRuns: number | null;
  runs: ScheduleRun[];
  createdAt: number;
  updatedAt: number;
  createdBy: ScheduleCreator;
  lastTaskId: string | null;
  lastRunId: string | null;
  lastReadAt: number | null;
  stopped: ScheduleStop | null;
  replayKeys: Record<string, number>;
}

export type WatchSuggestionOrigin =
  | { kind: 'source' }
  | { kind: 'agent'; taskId: string | null; runId: string | null };

export type WatchSuggestionStatus = 'open' | 'accepted' | 'dismissed';

export interface WatchSuggestion {
  id: string;
  projectId: string;
  server: string;
  name: string;
  text: string;
  trigger: ScheduleTrigger;
  timeZone: string;
  maxRuns: number | null;
  origin: WatchSuggestionOrigin;
  status: WatchSuggestionStatus;
  scheduleId: string | null;
  createdAt: number;
  decidedAt: number | null;
}

export interface GateSecret {
  label: string;
}

export const SCHEDULE_LIMITS = {
  name: 80,
  text: 8_000,
  prompt: 32_000,
  runsKept: 20,
  maxRuns: 1_000,
  minEveryMinutes: 1,
  maxEveryMinutes: 7 * 24 * 60,
  maxInMinutes: 365 * 24 * 60,
  onceGraceMs: MINUTE_MS,
  perTask: 20,
  live: 100,
  replayKeys: 500,
  replayTtlMs: 7 * DAY_MS,
  header: 100,
  prefix: 40,
  replayKey: 200,
  secretLabel: 80,
  secretReason: 300,
  detail: 300,
  readSummary: 1_000,
  readAttempts: 3,
  reportTitle: 100,
  reportRequest: 2_000,
  reportId: 200,
  reportLink: 2_000,
  reportAuthor: 120,
  reportPostedAt: 60,
  reportText: 4_000,
  filedListed: 10,
  reference: 200,
  timeZone: 60,
  runAt: 60,
  dailyAt: 5,
  secretRef: 60,
  weekdays: 7,
  suggestedEveryMinutes: 60,
  openSuggestions: 10,
} as const;

export const SECRET_REF_PATTERN = /^secret-ref:[0-9a-f]{32}$/;

export function isScheduleLive(schedule: Schedule) {
  return schedule.stopped === null;
}

export function isWatchHome(task: Pick<Task, 'watchHome'>) {
  return task.watchHome === true;
}

export function resolveSuggestedWatchText(server: string) {
  return `File a task for each new report in ${server}.`;
}

export function resolveSuggestedWatchName(server: string) {
  return `Watch ${server}`.slice(0, SCHEDULE_LIMITS.name);
}
