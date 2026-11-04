import { identity, Option, Predicate, Schema, SchemaTransformation } from 'effect';
import {
  Bool,
  ByDefault,
  Choice,
  Command,
  Count,
  FIELD_MESSAGES,
  FiniteNumber,
  ID_LIMIT,
  Id,
  List,
  NOTE_LIMIT,
  NullByDefault,
  Optional,
  OptionalChoice,
  OrNull,
  Strict,
  Text,
  Time,
} from '../domain/fields.ts';
import { MESSAGE_KINDS, ROUND_LIMITS, ROUND_SHIPPINGS } from '../domain/rounds.ts';
import { RunAccount } from '../domain/schema.ts';
import {
  FeedbackId,
  GateId,
  IdText,
  MemoryId,
  ProjectId,
  RepoId,
  RunId,
  ScheduleId,
  ServiceId,
  SuggestionId,
  TaskId,
  type Unbranded,
  WatchdogId,
} from '../domain/schema.ts';
import { ScheduleSource, ScheduleTarget, ScheduleTrigger } from '../domain/schema.ts';
import { SettingsPatch } from '../domain/schema.ts';
import { FindingVerdict, ReviewComment } from '../domain/schema.ts';
import { SHARE_LIMITS, SHARE_PRESETS } from '../domain/settings.ts';
import { TASK_SHAPES } from '../domain/shapes.ts';
import { TASK_PRIORITIES } from '../domain/stages.ts';
import { TASK_MODES } from '../domain/types.ts';
import { WORKSPACE_MODES } from '../domain/workspaces.ts';
import { CoverageSetting } from '../test-coverage/schema.ts';

const FEEDBACK_LIMIT = 20_000;

const RepoPatch = Strict(
  {
    name: Schema.optionalKey(Id()),
    defaultBranch: Schema.optionalKey(Id()),
    remote: Schema.optionalKey(OrNull(Text(ID_LIMIT), FIELD_MESSAGES.text)),
    projectId: Schema.optionalKey(OrNull(ProjectId, FIELD_MESSAGES.text)),
    checkCommands: Schema.optionalKey(List(Text())),
    workspace: Schema.optionalKey(Choice(WORKSPACE_MODES)),
    coverage: Schema.optionalKey(CoverageSetting),
  },
  'A repository update',
  'patch'
);

export const ProjectInput = Strict(
  {
    id: Optional(OrNull(ProjectId, FIELD_MESSAGES.text), FIELD_MESSAGES.text).pipe(
      Schema.decodeTo(
        Schema.optionalKey(Schema.toType(ProjectId)),
        SchemaTransformation.transformOptional({
          decode: (id) => Option.filter(id, Predicate.isNotNullish),
          encode: identity,
        })
      )
    ),
    name: Text(ID_LIMIT),
    color: Id(),
    key: Optional(Id(), FIELD_MESSAGES.text),
    description: Optional(Text(NOTE_LIMIT), FIELD_MESSAGES.text),
    folders: Optional(List(Id()), FIELD_MESSAGES.list),
    usageLimit: Optional(OrNull(FiniteNumber, FIELD_MESSAGES.number), FIELD_MESSAGES.number),
  },
  'A project',
  'project'
);

export type ProjectInput = Unbranded<typeof ProjectInput.Type>;

const NamedAccount = OrNull(RunAccount, FIELD_MESSAGES.object).pipe(
  Schema.refine(Predicate.isNotNull, { message: 'account must name an account.' })
);

export const UserCommand = Schema.Union([
  Command('repo.update', { repoId: RepoId, patch: RepoPatch }),
  Command('repo.remove', { repoId: RepoId }),
  Command('project.write', { project: ProjectInput }),
  Command('project.remove', { projectId: ProjectId }),
  Command('focus.change', {
    projectId: NullByDefault(ProjectId, FIELD_MESSAGES.text),
    teamId: Optional(OrNull(IdText, FIELD_MESSAGES.text), FIELD_MESSAGES.text),
    until: NullByDefault(Time, FIELD_MESSAGES.time),
  }),
  Command('away.record', { from: Time, to: Time }),
  Command('settings.change', { patch: SettingsPatch }),
  Command('task.create', {
    request: Text(),
    repoId: NullByDefault(RepoId, FIELD_MESSAGES.text),
    projectId: Optional(OrNull(ProjectId, FIELD_MESSAGES.text), FIELD_MESSAGES.text),
    priority: OptionalChoice(TASK_PRIORITIES),
    planFirst: Optional(Bool, FIELD_MESSAGES.boolean),
    origin: Optional(OrNull(Text(), FIELD_MESSAGES.text), FIELD_MESSAGES.text),
    waitsOn: Optional(List(TaskId), FIELD_MESSAGES.list),
    stacksOn: Optional(List(TaskId), FIELD_MESSAGES.list),
    mode: OptionalChoice(TASK_MODES),
    account: Optional(OrNull(RunAccount, FIELD_MESSAGES.object), FIELD_MESSAGES.object),
    forkOf: Optional(TaskId, FIELD_MESSAGES.text),
    backlog: Optional(Bool, FIELD_MESSAGES.boolean),
  }),
  Command('task.prioritize', { taskId: TaskId, priority: Choice(TASK_PRIORITIES) }),
  Command('task.wait_on', { taskId: TaskId, waitsOn: List(TaskId) }),
  Command('task.stack_on_tasks', { taskId: TaskId, stacksOn: List(TaskId) }),
  Command('task.move_to_backlog', { taskId: TaskId }),
  Command('task.remove_from_backlog', { taskId: TaskId }),
  Command('task.snooze', { taskId: TaskId }),
  Command('task.unsnooze', { taskId: TaskId }),
  Command('task.cancel', { taskId: TaskId }),
  Command('task.mark_duplicate', { taskId: TaskId, duplicateOf: TaskId }),
  Command('task.clear_duplicate', { taskId: TaskId }),
  Command('task.complete', { taskId: TaskId }),
  Command('task.retry', { taskId: TaskId, account: Optional(NamedAccount, FIELD_MESSAGES.object) }),
  Command('task.message', {
    taskId: TaskId,
    text: Text(),
    kind: OptionalChoice(MESSAGE_KINDS),
    title: Optional(Text(ROUND_LIMITS.title), FIELD_MESSAGES.text),
    why: Optional(Text(ROUND_LIMITS.why), FIELD_MESSAGES.text),
    shape: OptionalChoice(TASK_SHAPES),
    comments: Optional(List(ReviewComment, 100), FIELD_MESSAGES.list),
  }),
  Command('round.ship', { taskId: TaskId, number: Count, shipping: Choice(ROUND_SHIPPINGS) }),
  Command('round.update', { taskId: TaskId, number: Count, request: Text() }),
  Command('round.remove', { taskId: TaskId, number: Count }),
  Command('round.send', { taskId: TaskId, number: Count }),
  Command('gate.answer', {
    gateId: GateId,
    decision: Choice(['approve', 'revise', 'reject', 'reply']),
    response: NullByDefault(Text(), FIELD_MESSAGES.text),
    planVersion: Optional(Count, FIELD_MESSAGES.count),
    verdicts: Optional(List(FindingVerdict, 50), FIELD_MESSAGES.list),
    comments: Optional(List(ReviewComment, 100), FIELD_MESSAGES.list),
    thenApprove: Optional(Bool, FIELD_MESSAGES.boolean),
  }),
  Command('merge_step.tick', { taskId: TaskId, key: Id(120), done: Bool }),
  Command('suggestion.accept', {
    taskId: TaskId,
    suggestionId: SuggestionId,
    waitsOnThis: Bool,
    backlog: Optional(Bool, FIELD_MESSAGES.boolean),
  }),
  Command('suggestion.dismiss', { taskId: TaskId, suggestionId: SuggestionId }),
  Command('suggestion.keep', {
    taskId: TaskId,
    suggestionId: SuggestionId,
    shape: OptionalChoice(TASK_SHAPES),
  }),
  Command('monitor.check_in_now', { taskId: TaskId }),
  Command('run.snooze_silence', { runId: RunId, until: Time }),
  Command('run.dismiss_silence', { runId: RunId }),
  Command('task.bind_account', { taskId: TaskId, account: OrNull(RunAccount, FIELD_MESSAGES.object) }),
  Command('usage_wait.change', { taskId: TaskId, autoResume: Bool }),
  Command('usage_wait.resume_now', { taskId: TaskId }),
  Command('delegation.cancel', { runId: RunId }),
  Command('schedule.enable', { scheduleId: ScheduleId, enabled: Bool }),
  Command('schedule.remove', { scheduleId: ScheduleId }),
  Command('schedule.write', {
    scheduleId: NullByDefault(ScheduleId, FIELD_MESSAGES.text),
    name: NullByDefault(Text(ID_LIMIT), FIELD_MESSAGES.text),
    text: NullByDefault(Text(), FIELD_MESSAGES.text),
    trigger: NullByDefault(ScheduleTrigger, FIELD_MESSAGES.object),
    target: NullByDefault(ScheduleTarget, FIELD_MESSAGES.object),
    source: NullByDefault(ScheduleSource, FIELD_MESSAGES.object),
    enabled: NullByDefault(Bool, FIELD_MESSAGES.boolean),
    maxRuns: NullByDefault(Count, FIELD_MESSAGES.count),
    timeZone: Id(),
  }),
  Command('watch_suggestion.accept', { suggestionId: IdText }),
  Command('watch_suggestion.dismiss', { suggestionId: IdText }),
  Command('watchdog.stop', { taskId: TaskId, watchdogId: WatchdogId }),
  Command('watchdog.connect', {
    taskId: TaskId,
    watchdogId: WatchdogId,
    server: Text(ID_LIMIT),
    data: Text(NOTE_LIMIT),
  }),
  Command('watch_source.write', {
    projectId: ProjectId,
    server: Text(ID_LIMIT),
    data: Text(NOTE_LIMIT),
    repoIds: ByDefault(List(RepoId), FIELD_MESSAGES.list, () => []),
  }),
  Command('watch_source.remove', { projectId: ProjectId, server: Text(ID_LIMIT) }),
  Command('memory.write', {
    memoryId: NullByDefault(MemoryId, FIELD_MESSAGES.text),
    projectId: NullByDefault(ProjectId, FIELD_MESSAGES.text),
    text: Text(),
  }),
  Command('memory.accept', { memoryId: MemoryId }),
  Command('memory.remove', { memoryId: MemoryId }),
  Command('feedback.write', {
    feedbackId: NullByDefault(FeedbackId, FIELD_MESSAGES.text),
    note: Text(FEEDBACK_LIMIT),
  }),
  Command('feedback.update', {
    feedbackId: FeedbackId,
    title: Text(FEEDBACK_LIMIT),
    body: Text(FEEDBACK_LIMIT),
  }),
  Command('feedback.file', { feedbackId: FeedbackId }),
  Command('feedback.dismiss', { feedbackId: FeedbackId }),
  Command('task.share', {
    taskId: TaskId,
    limit: Schema.optionalKey(Choice(SHARE_LIMITS)),
    preset: Schema.optionalKey(Choice(SHARE_PRESETS)),
  }),
  Command('task.unshare', { taskId: TaskId }),
  Command('project.add_to_team', { projectId: ProjectId, teamId: IdText }),
  Command('project.remove_from_team', { projectId: ProjectId, teamId: IdText }),
  Command('preview.share', {
    taskId: TaskId,
    serviceId: ServiceId,
    limit: Schema.optionalKey(Choice(SHARE_LIMITS)),
  }),
  Command('preview.unshare', { taskId: TaskId, serviceId: ServiceId }),
  Command('task.hand_off', { taskId: TaskId }),
  Command('handoff.remove', { taskId: TaskId }),
]);

export type ParsedUserCommand = typeof UserCommand.Type;

export type UserCommand = Unbranded<ParsedUserCommand>;

export const USER_COMMAND_TYPES: UserCommand['type'][] = UserCommand.members.map(
  (member) => member.fields.type.literal
);
