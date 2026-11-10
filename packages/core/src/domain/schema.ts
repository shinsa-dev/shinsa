import { type Brand, identity, Schema, SchemaTransformation } from 'effect';
import { AGENT_ROLES } from '../agent-models/index.ts';
import {
  Bool,
  ByDefault,
  Choice,
  Count,
  FIELD_MESSAGES,
  FiniteNumber,
  ID_LIMIT,
  Id,
  Index,
  List,
  NOTE_LIMIT,
  NullByDefault,
  NumberOf,
  OrNull,
  resolveChoiceMessage,
  RoleMap,
  Strict,
  Tagged,
  Text,
  Time,
  WholeNumber,
} from './fields.ts';
import { SCHEDULE_TRIGGER_KINDS, WEBHOOK_ENCODINGS } from './schedules.ts';
import {
  ACTIVE_DAY_LIMIT,
  AUTOPILOT_CONTACT_KINDS,
  AUTOPILOT_MERGES,
  AUTOPILOT_RISKS,
  AUTOPILOT_URGENT_ACTIONS,
  COMPACTION_MODES,
  MAX_AUTOPILOT_CONTACTS,
  MERGE_METHODS,
  PLAN_APPROVALS,
  type SETTINGS_KEYS,
  SHARE_LIMITS,
  SHARE_PRESETS,
} from './settings.ts';
import { TASK_PRIORITIES } from './stages.ts';
import { COMMENT_PATH_LIMIT, COMMENT_SIDES, FINDING_VERDICT_KINDS, TASK_MODES } from './types.ts';

export const IdText = Id();

export const TaskId = IdText.pipe(Schema.brand('TaskId'));

export type TaskId = typeof TaskId.Type;

export const RunId = IdText.pipe(Schema.brand('RunId'));

export type RunId = typeof RunId.Type;

export const GateId = IdText.pipe(Schema.brand('GateId'));

export type GateId = typeof GateId.Type;

export const ProjectId = IdText.pipe(Schema.brand('ProjectId'));

export type ProjectId = typeof ProjectId.Type;

export const RepoId = IdText.pipe(Schema.brand('RepoId'));

export type RepoId = typeof RepoId.Type;

export const ScheduleId = IdText.pipe(Schema.brand('ScheduleId'));

export type ScheduleId = typeof ScheduleId.Type;

export const SuggestionId = IdText.pipe(Schema.brand('SuggestionId'));

export type SuggestionId = typeof SuggestionId.Type;

export const FeedbackId = IdText.pipe(Schema.brand('FeedbackId'));

export type FeedbackId = typeof FeedbackId.Type;

export const WatchdogId = IdText.pipe(Schema.brand('WatchdogId'));

export type WatchdogId = typeof WatchdogId.Type;

export const ServiceId = IdText.pipe(Schema.brand('ServiceId'));

export type ServiceId = typeof ServiceId.Type;

export const MemoryId = IdText.pipe(Schema.brand('MemoryId'));

export type MemoryId = typeof MemoryId.Type;

export type Unbranded<T> =
  T extends Brand.Brand<string>
    ? Brand.Brand.Unbranded<T>
    : T extends object
      ? { [Key in keyof T]: Unbranded<T[Key]> }
      : T;

const SLACK_CONTACT_ID_MESSAGE = 'A Slack id is letters, digits, dots, dashes and underscores.';

const SlackContactId = Id(64).check(
  Schema.isPattern(/^[A-Za-z0-9._-]+$/, { message: SLACK_CONTACT_ID_MESSAGE })
);

const SLACK_IMAGE_MESSAGE = 'A Slack picture is an https address.';

const SlackContactImage = Id(500).check(
  Schema.isPattern(/^https:\/\/\S+$/, { message: SLACK_IMAGE_MESSAGE })
);

const SlackContactFields = { teamId: SlackContactId, id: SlackContactId, name: Id(80) };

export const AutopilotContactPatch = Tagged('kind', AUTOPILOT_CONTACT_KINDS, [
  Schema.Struct({ kind: Schema.Literal('slack_channel'), ...SlackContactFields }),
  Schema.Struct({
    kind: Schema.Literal('slack_person'),
    ...SlackContactFields,
    image: Schema.optionalKey(SlackContactImage),
  }),
]);

const AutopilotPatch = Strict(
  {
    enabled: Schema.optionalKey(Bool),
    approveUpTo: Schema.optionalKey(Choice(AUTOPILOT_RISKS)),
    urgentApproveUpTo: Schema.optionalKey(Choice(AUTOPILOT_RISKS)),
    merge: Schema.optionalKey(Choice(AUTOPILOT_MERGES)),
    urgent: Schema.optionalKey(Choice(AUTOPILOT_URGENT_ACTIONS)),
    urgentWaitMinutes: Schema.optionalKey(WholeNumber),
    quietWaitMinutes: Schema.optionalKey(WholeNumber),
    ignoreUsageLimits: Schema.optionalKey(Bool),
    contacts: Schema.optionalKey(List(AutopilotContactPatch, MAX_AUTOPILOT_CONTACTS)),
  },
  'Autopilot',
  'autopilot'
);

const ActiveDayPatch = Strict(
  { weekday: WholeNumber, from: WholeNumber, to: WholeNumber },
  'Active hours',
  'activeHours day'
);

export const SettingsPatch = Strict(
  {
    defaultProvider: Schema.optionalKey(Id()),
    defaultModel: Schema.optionalKey(OrNull(Id(), FIELD_MESSAGES.text)),
    maxFixRounds: Schema.optionalKey(OrNull(WholeNumber, FIELD_MESSAGES.wholeNumber)),
    delegationLimit: Schema.optionalKey(OrNull(WholeNumber, FIELD_MESSAGES.wholeNumber)),
    mergeMethod: Schema.optionalKey(Choice(MERGE_METHODS)),
    attentionLimit: Schema.optionalKey(WholeNumber),
    taskCapacity: Schema.optionalKey(OrNull(WholeNumber, FIELD_MESSAGES.wholeNumber)),
    placementPolicies: Schema.optionalKey(List(Text())),
    shareLimit: Schema.optionalKey(Choice(SHARE_LIMITS)),
    sharePreset: Schema.optionalKey(Choice(SHARE_PRESETS)),
    approvePlans: Schema.optionalKey(Choice(PLAN_APPROVALS)),
    agentModels: Schema.optionalKey(RoleMap('agentModels', AGENT_ROLES, Id())),
    agentProviders: Schema.optionalKey(RoleMap('agentProviders', AGENT_ROLES, Id())),
    agentFastModes: Schema.optionalKey(RoleMap('agentFastModes', AGENT_ROLES, Bool)),
    taskBudgetUsd: Schema.optionalKey(OrNull(FiniteNumber, FIELD_MESSAGES.number)),
    taskUsageLimit: Schema.optionalKey(OrNull(WholeNumber, FIELD_MESSAGES.wholeNumber)),
    dailyUsageLimit: Schema.optionalKey(OrNull(FiniteNumber, FIELD_MESSAGES.number)),
    autoResume: Schema.optionalKey(Bool),
    snoozeLimited: Schema.optionalKey(Bool),
    accountSwitchAt: Schema.optionalKey(WholeNumber),
    idleCompaction: Schema.optionalKey(Bool),
    compactionLeadMinutes: Schema.optionalKey(WholeNumber),
    compaction: Schema.optionalKey(Choice(COMPACTION_MODES)),
    fastMode: Schema.optionalKey(Bool),
    watchdogHours: Schema.optionalKey(WholeNumber),
    watchdogFirstCheckMinutes: Schema.optionalKey(WholeNumber),
    watchdogMaxGapHours: Schema.optionalKey(WholeNumber),
    autopilot: Schema.optionalKey(AutopilotPatch),
    watchdogsIgnoreUsageLimits: Schema.optionalKey(Bool),
    autoPace: Schema.optionalKey(Bool),
    sharedTeams: Schema.optionalKey(List(Id())),
    activeHours: Schema.optionalKey(OrNull(List(ActiveDayPatch, ACTIVE_DAY_LIMIT), FIELD_MESSAGES.list)),
  } satisfies Record<(typeof SETTINGS_KEYS)[number], Schema.Top>,
  'Settings',
  'patch'
);

export type SettingsPatch = typeof SettingsPatch.Type;

export const RunAccount = Strict(
  { id: Id(), email: NullByDefault(Text(ID_LIMIT), FIELD_MESSAGES.text) },
  'An account',
  '{key}'
);

export type RunAccount = typeof RunAccount.Type;

export const FindingVerdict = Strict(
  {
    index: Index,
    verdict: Choice(FINDING_VERDICT_KINDS),
    note: NullByDefault(Text(NOTE_LIMIT), FIELD_MESSAGES.text),
  },
  'A verdict'
);

export type FindingVerdict = typeof FindingVerdict.Type;

export const ReviewComment = Strict(
  {
    path: Id(COMMENT_PATH_LIMIT),
    side: Choice(COMMENT_SIDES),
    line: Count,
    endLine: NullByDefault(Count, FIELD_MESSAGES.count),
    text: Text(),
  },
  'A comment'
);

export type ReviewComment = typeof ReviewComment.Type;

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
  Schema.Struct({
    kind: Schema.Literal('slack'),
    teamId: Id(),
    teamName: Id(),
    channelId: Id(),
    channelName: Id(),
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
