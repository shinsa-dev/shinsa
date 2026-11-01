import { AGENT_ROLES } from '../agent-models/index.ts';
import type { RunAccount } from '../domain/accounts.ts';
import { DomainError } from '../domain/errors.ts';
import {
  MESSAGE_KINDS,
  type MessageKind,
  ROUND_LIMITS,
  ROUND_SHIPPINGS,
  type RoundShipping,
} from '../domain/rounds.ts';
import type {
  ScheduleSource,
  ScheduleTarget,
  ScheduleTrigger,
  WebhookEncoding,
  WebhookSignature,
} from '../domain/schedules.ts';
import {
  COMPACTION_MODES,
  MERGE_METHODS,
  PLAN_APPROVALS,
  SETTINGS_KEYS,
  type Settings,
  SHARE_LIMITS,
  SHARE_PRESETS,
  type ShareLimit,
  type SharePreset,
} from '../domain/settings.ts';
import { TASK_SHAPES, type TaskShape } from '../domain/shapes.ts';
import { TASK_PRIORITIES } from '../domain/stages.ts';
import type {
  AgentRole,
  CommentSide,
  FindingVerdict,
  FindingVerdictKind,
  GateDecision,
  ReviewComment,
  TaskMode,
  TaskPriority,
} from '../domain/types.ts';
import { WORKSPACE_MODES, type WorkspaceMode } from '../domain/workspaces.ts';
import { resolveCoverageFormat } from '../test-coverage/setting.ts';
import {
  COVERAGE_FORMATS,
  COVERAGE_LIMITS,
  COVERAGE_MODES,
  type CoverageFormat,
  type CoverageMode,
  type CoverageSetting,
} from '../test-coverage/types.ts';
import type { ProjectInput, UserCommand } from './index.ts';

type Fields = Record<string, unknown>;

type RepoPatch = Extract<UserCommand, { type: 'repo.update' }>['patch'];

const MAX_ID = 200;

const MAX_TEXT = 200_000;

const MAX_LIST = 500;

const PRIORITIES: ReadonlySet<TaskPriority> = new Set(TASK_PRIORITIES);

const DECISIONS = new Set<GateDecision>(['approve', 'revise', 'reject', 'reply']);

const ROLES: ReadonlySet<AgentRole> = new Set(AGENT_ROLES);

const MODES = new Set<TaskMode>(['build', 'ask']);

const SHAPES = new Set<TaskShape>(TASK_SHAPES);

const VERDICTS = new Set<FindingVerdictKind>(['fix', 'dismiss']);

const KINDS: ReadonlySet<MessageKind> = new Set(MESSAGE_KINDS);

const SHIPPINGS: ReadonlySet<RoundShipping> = new Set(ROUND_SHIPPINGS);

const WORKSPACES: ReadonlySet<WorkspaceMode> = new Set(WORKSPACE_MODES);

const COVERAGE_MODE_SET: ReadonlySet<CoverageMode> = new Set(COVERAGE_MODES);

const COVERAGE_FORMAT_SET: ReadonlySet<CoverageFormat> = new Set(COVERAGE_FORMATS);

const SHARE_LIMIT_SET: ReadonlySet<ShareLimit> = new Set(SHARE_LIMITS);

const SHARE_PRESET_SET: ReadonlySet<SharePreset> = new Set(SHARE_PRESETS);

const MAX_VERDICTS = 50;

const SIDES = new Set<CommentSide>(['old', 'new']);

const MAX_COMMENTS = 100;

const MAX_PATH = 1_024;

const MAX_NOTE = 2_000;

const MAX_FEEDBACK = 20_000;

const MAX_STEP_KEY = 120;

function refuse(message: string): never {
  throw new DomainError('command_invalid', message);
}

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readObject(value: unknown, name: string): Fields {
  if (!isFields(value)) refuse(`${name} must be an object.`);
  return value;
}

function readText(fields: Fields, key: string, max = MAX_TEXT): string {
  const value = fields[key];
  if (typeof value !== 'string') refuse(`${key} must be text.`);
  if (value.length > max) refuse(`${key} is longer than ${max} characters.`);
  return value;
}

function readId(fields: Fields, key: string, max = MAX_ID) {
  const value = readText(fields, key, max);
  if (value.length === 0) refuse(`${key} must not be empty.`);
  return value;
}

function readNullableText(fields: Fields, key: string, max = MAX_TEXT) {
  if (fields[key] === null || fields[key] === undefined) return null;
  return readText(fields, key, max);
}

function readNullableId(fields: Fields, key: string) {
  if (fields[key] === null || fields[key] === undefined) return null;
  return readId(fields, key);
}

function readList(fields: Fields, key: string, readItem: (item: Fields, key: string) => string) {
  const value = fields[key];
  if (!Array.isArray(value)) refuse(`${key} must be a list.`);
  if (value.length > MAX_LIST) refuse(`${key} has more than ${MAX_LIST} entries.`);
  return value.map((item) => readItem({ [key]: item }, key));
}

function readChoice<T extends string>(fields: Fields, key: string, choices: ReadonlySet<T>): T {
  const value = fields[key];
  if (typeof value !== 'string' || !choices.has(value as T))
    refuse(`${key} must be one of ${[...choices].join(', ')}.`);
  return value as T;
}

function readBoolean(fields: Fields, key: string) {
  if (typeof fields[key] !== 'boolean') refuse(`${key} must be true or false.`);
  return fields[key] as boolean;
}

function readCount(fields: Fields, key: string) {
  const value = fields[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    refuse(`${key} must be a whole number of 1 or more.`);
  }
  return value;
}

function readTime(fields: Fields, key: string) {
  const value = fields[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) refuse(`${key} must be a time.`);
  return value;
}

function readNumber(fields: Fields, key: string) {
  const value = fields[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) refuse(`${key} must be a number.`);
  return value;
}

function readInteger(fields: Fields, key: string) {
  const value = fields[key];
  if (typeof value !== 'number' || !Number.isInteger(value)) refuse(`${key} must be a whole number.`);
  return value;
}

function readNullableInteger(fields: Fields, key: string) {
  return fields[key] === null ? null : readInteger(fields, key);
}

function readAccount(fields: Fields, key: string): RunAccount | null {
  if (fields[key] === null) return null;
  const account = readObject(fields[key], key);
  readKnownKeys(account, ['id', 'email'], 'An account');
  return { id: readId(account, 'id'), email: readNullableText(account, 'email', MAX_ID) };
}

function readIndex(fields: Fields, key: string) {
  const value = fields[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    refuse(`${key} must be a whole number of 0 or more.`);
  }
  return value;
}

function readVerdicts(value: unknown): FindingVerdict[] {
  if (!Array.isArray(value)) refuse('verdicts must be a list.');
  if (value.length > MAX_VERDICTS) refuse(`verdicts has more than ${MAX_VERDICTS} entries.`);
  return value.map((item) => {
    const fields = readObject(item, 'A verdict');
    readKnownKeys(fields, ['index', 'verdict', 'note'], 'A verdict');
    return {
      index: readIndex(fields, 'index'),
      verdict: readChoice(fields, 'verdict', VERDICTS),
      note: readNullableText(fields, 'note', MAX_NOTE),
    };
  });
}

function readComments(value: unknown): ReviewComment[] {
  if (!Array.isArray(value)) refuse('comments must be a list.');
  if (value.length > MAX_COMMENTS) refuse(`comments has more than ${MAX_COMMENTS} entries.`);
  return value.map((item) => {
    const fields = readObject(item, 'A comment');
    readKnownKeys(fields, ['path', 'side', 'line', 'endLine', 'text'], 'A comment');
    return {
      path: readId(fields, 'path', MAX_PATH),
      side: readChoice(fields, 'side', SIDES),
      line: readCount(fields, 'line'),
      endLine: fields.endLine === null || fields.endLine === undefined ? null : readCount(fields, 'endLine'),
      text: readText(fields, 'text'),
    };
  });
}

function readGateAnswer(fields: Fields): UserCommand {
  return {
    type: 'gate.answer',
    gateId: readId(fields, 'gateId'),
    decision: readChoice(fields, 'decision', DECISIONS),
    response: readNullableText(fields, 'response'),
    ...(fields.planVersion === undefined ? {} : { planVersion: readCount(fields, 'planVersion') }),
    ...(fields.verdicts === undefined ? {} : { verdicts: readVerdicts(fields.verdicts) }),
    ...(fields.comments === undefined ? {} : { comments: readComments(fields.comments) }),
  };
}

function readKnownKeys(fields: Fields, allowed: readonly string[], name: string) {
  for (const key of Object.keys(fields)) {
    if (!allowed.includes(key)) refuse(`${name} cannot change ${key}.`);
  }
}

function readReportPath(fields: Fields) {
  const report = readId(fields, 'report', COVERAGE_LIMITS.report).trim();
  const segments = report.replace(/\\/g, '/').split('/');
  if (
    !report ||
    report.startsWith('/') ||
    /^[A-Za-z]:/.test(report) ||
    segments.includes('..') ||
    report.includes('\0')
  ) {
    refuse('report must be a path inside the repository, such as coverage/lcov.info.');
  }
  return report;
}

function readCoverage(value: unknown): CoverageSetting {
  const fields = readObject(value, 'coverage');
  const mode = readChoice(fields, 'mode', COVERAGE_MODE_SET);
  if (mode !== 'custom') {
    readKnownKeys(fields, ['mode'], 'Coverage set to auto or off');
    return { mode };
  }
  readKnownKeys(fields, ['mode', 'command', 'report', 'format'], 'Custom coverage');
  const command = readId(fields, 'command', COVERAGE_LIMITS.command).trim();
  if (!command) refuse('command must not be empty.');
  const report = readReportPath(fields);
  const format =
    fields.format === null || fields.format === undefined
      ? null
      : readChoice(fields, 'format', COVERAGE_FORMAT_SET);
  if (!(format ?? resolveCoverageFormat(report))) {
    refuse(`Shinsa cannot tell the format of ${report} from its name. Give format: lcov, cobertura or go.`);
  }
  return { mode, command, report, format };
}

const REPO_PATCH_KEYS = [
  'name',
  'defaultBranch',
  'remote',
  'projectId',
  'checkCommands',
  'workspace',
  'coverage',
] as const;

function readRepoPatch(value: unknown): RepoPatch {
  const fields = readObject(value, 'patch');
  readKnownKeys(fields, REPO_PATCH_KEYS, 'A repository update');
  const patch: RepoPatch = {};
  if ('name' in fields) patch.name = readId(fields, 'name');
  if ('defaultBranch' in fields) patch.defaultBranch = readId(fields, 'defaultBranch');
  if ('remote' in fields) patch.remote = readNullableText(fields, 'remote', MAX_ID);
  if ('projectId' in fields) patch.projectId = readNullableId(fields, 'projectId');
  if ('checkCommands' in fields) patch.checkCommands = readList(fields, 'checkCommands', readText);
  if ('workspace' in fields) patch.workspace = readChoice(fields, 'workspace', WORKSPACES);
  if ('coverage' in fields) patch.coverage = readCoverage(fields.coverage);
  return patch;
}

function readRoleIds(value: unknown, name: 'agentModels' | 'agentProviders') {
  const fields = readObject(value, name);
  const ids: Partial<Record<AgentRole, string>> = {};
  for (const role of Object.keys(fields)) {
    if (!ROLES.has(role as AgentRole)) refuse(`${name} has no role ${role}.`);
    ids[role as AgentRole] = readId(fields, role);
  }
  return ids;
}

function readRoleSwitches(value: unknown) {
  const fields = readObject(value, 'agentFastModes');
  const switches: Partial<Record<AgentRole, boolean>> = {};
  for (const role of Object.keys(fields)) {
    if (!ROLES.has(role as AgentRole)) refuse(`agentFastModes has no role ${role}.`);
    switches[role as AgentRole] = readBoolean(fields, role);
  }
  return switches;
}

function readPlacementPatch(fields: Record<string, unknown>): Partial<Settings> {
  const patch: Partial<Settings> = {};
  if ('taskCapacity' in fields) patch.taskCapacity = readNullableInteger(fields, 'taskCapacity');
  if ('placementPolicies' in fields)
    patch.placementPolicies = readList(fields, 'placementPolicies', readText);
  return patch;
}

function readSharePatch(fields: Record<string, unknown>): Partial<Settings> {
  const patch: Partial<Settings> = {};
  if ('shareLimit' in fields) patch.shareLimit = readChoice(fields, 'shareLimit', SHARE_LIMIT_SET);
  if ('sharePreset' in fields) patch.sharePreset = readChoice(fields, 'sharePreset', SHARE_PRESET_SET);
  return patch;
}

function readSettingsPatch(value: unknown): Partial<Settings> {
  const fields = readObject(value, 'patch');
  readKnownKeys(fields, SETTINGS_KEYS, 'Settings');
  const patch: Partial<Settings> = {};
  if ('defaultProvider' in fields) patch.defaultProvider = readId(fields, 'defaultProvider');
  if ('defaultModel' in fields) patch.defaultModel = readNullableId(fields, 'defaultModel');
  if ('maxFixRounds' in fields) patch.maxFixRounds = readNullableInteger(fields, 'maxFixRounds');
  if ('delegationLimit' in fields) patch.delegationLimit = readNullableInteger(fields, 'delegationLimit');
  if ('mergeMethod' in fields) patch.mergeMethod = readChoice(fields, 'mergeMethod', MERGE_METHODS);
  if ('attentionLimit' in fields) patch.attentionLimit = readInteger(fields, 'attentionLimit');
  Object.assign(patch, readPlacementPatch(fields), readSharePatch(fields));
  if ('approvePlans' in fields) patch.approvePlans = readChoice(fields, 'approvePlans', PLAN_APPROVALS);
  if ('agentModels' in fields) patch.agentModels = readRoleIds(fields.agentModels, 'agentModels');
  if ('agentProviders' in fields) {
    patch.agentProviders = readRoleIds(fields.agentProviders, 'agentProviders');
  }
  if ('agentFastModes' in fields) patch.agentFastModes = readRoleSwitches(fields.agentFastModes);
  if ('taskBudgetUsd' in fields) {
    patch.taskBudgetUsd = fields.taskBudgetUsd === null ? null : readNumber(fields, 'taskBudgetUsd');
  }
  if ('taskUsageLimit' in fields) patch.taskUsageLimit = readNullableInteger(fields, 'taskUsageLimit');
  if ('autoResume' in fields) patch.autoResume = readBoolean(fields, 'autoResume');
  if ('snoozeLimited' in fields) patch.snoozeLimited = readBoolean(fields, 'snoozeLimited');
  if ('accountSwitchAt' in fields) patch.accountSwitchAt = readInteger(fields, 'accountSwitchAt');
  if ('idleCompaction' in fields) patch.idleCompaction = readBoolean(fields, 'idleCompaction');
  if ('compactionLeadMinutes' in fields) {
    patch.compactionLeadMinutes = readInteger(fields, 'compactionLeadMinutes');
  }
  if ('compaction' in fields) patch.compaction = readChoice(fields, 'compaction', COMPACTION_MODES);
  if ('fastMode' in fields) patch.fastMode = readBoolean(fields, 'fastMode');
  if ('watchdogHours' in fields) patch.watchdogHours = readInteger(fields, 'watchdogHours');
  if ('watchdogFirstCheckMinutes' in fields) {
    patch.watchdogFirstCheckMinutes = readInteger(fields, 'watchdogFirstCheckMinutes');
  }
  if ('watchdogMaxGapHours' in fields) patch.watchdogMaxGapHours = readInteger(fields, 'watchdogMaxGapHours');
  return patch;
}

function readTaskCreate(fields: Fields): UserCommand {
  return {
    type: 'task.create',
    request: readText(fields, 'request'),
    repoId: readNullableId(fields, 'repoId'),
    ...(fields.projectId === undefined ? {} : { projectId: readNullableId(fields, 'projectId') }),
    ...(fields.priority === undefined ? {} : { priority: readChoice(fields, 'priority', PRIORITIES) }),
    ...(fields.planFirst === undefined ? {} : { planFirst: readBoolean(fields, 'planFirst') }),
    ...(fields.origin === undefined ? {} : { origin: readNullableText(fields, 'origin') }),
    ...(fields.waitsOn === undefined ? {} : { waitsOn: readList(fields, 'waitsOn', readId) }),
    ...(fields.stacksOn === undefined ? {} : { stacksOn: readId(fields, 'stacksOn') }),
    ...(fields.mode === undefined ? {} : { mode: readChoice(fields, 'mode', MODES) }),
    ...(fields.account === undefined ? {} : { account: readAccount(fields, 'account') }),
    ...(fields.forkOf === undefined ? {} : { forkOf: readId(fields, 'forkOf') }),
    ...(fields.backlog === undefined ? {} : { backlog: readBoolean(fields, 'backlog') }),
  };
}

const PROJECT_KEYS = ['id', 'name', 'color', 'key', 'description', 'folders'] as const;

function readProject(value: unknown): ProjectInput {
  const fields = readObject(value, 'project');
  readKnownKeys(fields, PROJECT_KEYS, 'A project');
  const id = readNullableId(fields, 'id');
  return {
    ...(id === null ? {} : { id }),
    name: readText(fields, 'name', MAX_ID),
    color: readId(fields, 'color'),
    ...(fields.key === undefined ? {} : { key: readId(fields, 'key') }),
    ...(fields.description === undefined ? {} : { description: readText(fields, 'description', MAX_NOTE) }),
    ...(fields.folders === undefined ? {} : { folders: readList(fields, 'folders', readId) }),
  };
}

function readFocusChange(fields: Fields): UserCommand {
  return {
    type: 'focus.change',
    projectId: readNullableId(fields, 'projectId'),
    until: readTime(fields, 'until'),
  };
}

function readTaskWaitOn(fields: Fields): UserCommand {
  return {
    type: 'task.wait_on',
    taskId: readId(fields, 'taskId'),
    waitsOn: readList(fields, 'waitsOn', readId),
  };
}

function readTaskStackOn(fields: Fields): UserCommand {
  return {
    type: 'task.stack_on',
    taskId: readId(fields, 'taskId'),
    stacksOn: readNullableId(fields, 'stacksOn'),
  };
}

function readTaskPrioritize(fields: Fields): UserCommand {
  return {
    type: 'task.prioritize',
    taskId: readId(fields, 'taskId'),
    priority: readChoice(fields, 'priority', PRIORITIES),
  };
}

function readMergeStepTick(fields: Fields): UserCommand {
  return {
    type: 'merge_step.tick',
    taskId: readId(fields, 'taskId'),
    key: readId(fields, 'key', MAX_STEP_KEY),
    done: readBoolean(fields, 'done'),
  };
}

function readSuggestionAccept(fields: Fields): UserCommand {
  return {
    type: 'suggestion.accept',
    taskId: readId(fields, 'taskId'),
    suggestionId: readId(fields, 'suggestionId'),
    waitsOnThis: readBoolean(fields, 'waitsOnThis'),
    ...(fields.backlog === undefined ? {} : { backlog: readBoolean(fields, 'backlog') }),
  };
}

function readSuggestionDismiss(fields: Fields): UserCommand {
  return {
    type: 'suggestion.dismiss',
    taskId: readId(fields, 'taskId'),
    suggestionId: readId(fields, 'suggestionId'),
  };
}

function readSuggestionKeep(fields: Fields): UserCommand {
  return {
    type: 'suggestion.keep',
    taskId: readId(fields, 'taskId'),
    suggestionId: readId(fields, 'suggestionId'),
    ...(fields.shape === undefined ? {} : { shape: readChoice(fields, 'shape', SHAPES) }),
  };
}

function readTaskMessage(fields: Fields): UserCommand {
  return {
    type: 'task.message',
    taskId: readId(fields, 'taskId'),
    text: readText(fields, 'text'),
    ...(fields.kind === undefined ? {} : { kind: readChoice(fields, 'kind', KINDS) }),
    ...(fields.title === undefined ? {} : { title: readText(fields, 'title', ROUND_LIMITS.title) }),
    ...(fields.why === undefined ? {} : { why: readText(fields, 'why', ROUND_LIMITS.why) }),
    ...(fields.shape === undefined ? {} : { shape: readChoice(fields, 'shape', SHAPES) }),
  };
}

function readRoundShip(fields: Fields): UserCommand {
  return {
    type: 'round.ship',
    taskId: readId(fields, 'taskId'),
    number: readCount(fields, 'number'),
    shipping: readChoice(fields, 'shipping', SHIPPINGS),
  };
}

function readRoundUpdate(fields: Fields): UserCommand {
  return {
    type: 'round.update',
    taskId: readId(fields, 'taskId'),
    number: readCount(fields, 'number'),
    request: readText(fields, 'request'),
  };
}

function readSnooze(fields: Fields): UserCommand {
  return {
    type: 'run.snooze_silence',
    runId: readId(fields, 'runId'),
    until: readTime(fields, 'until') ?? refuse('until must be a time.'),
  };
}

function readRetry(fields: Fields): UserCommand {
  const taskId = readId(fields, 'taskId');
  if (fields.account === undefined) return { type: 'task.retry', taskId };
  const account = readAccount(fields, 'account');
  if (!account) refuse('account must name an account.');
  return { type: 'task.retry', taskId, account };
}

function readAccountBinding(fields: Fields): UserCommand {
  return {
    type: 'task.bind_account',
    taskId: readId(fields, 'taskId'),
    account: readAccount(fields, 'account'),
  };
}

function readUsageWaitChange(fields: Fields): UserCommand {
  return {
    type: 'usage_wait.change',
    taskId: readId(fields, 'taskId'),
    autoResume: readBoolean(fields, 'autoResume'),
  };
}

function readScheduleEnable(fields: Fields): UserCommand {
  return {
    type: 'schedule.enable',
    scheduleId: readId(fields, 'scheduleId'),
    enabled: readBoolean(fields, 'enabled'),
  };
}

const TRIGGER_KINDS = new Set<ScheduleTrigger['kind']>(['once', 'interval', 'daily', 'webhook']);

const ENCODINGS = new Set<WebhookEncoding>(['hex', 'base64']);

const TARGET_KINDS = new Set<ScheduleTarget['kind']>(['new_task', 'task']);

function readWeekdays(fields: Fields) {
  const value = fields.weekdays;
  if (!Array.isArray(value) || value.length > 7) refuse('weekdays must be a list of up to 7 days.');
  return value.map((day) => readInteger({ day }, 'day'));
}

function readSignature(value: unknown): WebhookSignature | null {
  if (value === null || value === undefined) return null;
  const fields = readObject(value, 'signature');
  readKnownKeys(fields, ['header', 'encoding', 'prefix'], 'A signature');
  return {
    header: readId(fields, 'header'),
    encoding: fields.encoding === undefined ? 'hex' : readChoice(fields, 'encoding', ENCODINGS),
    prefix: readNullableText(fields, 'prefix', MAX_ID) ?? '',
  };
}

function readTrigger(value: unknown): ScheduleTrigger | null {
  if (value === null || value === undefined) return null;
  const fields = readObject(value, 'trigger');
  const kind = readChoice(fields, 'kind', TRIGGER_KINDS);
  switch (kind) {
    case 'once':
      return { kind, at: readTime(fields, 'at') ?? refuse('at must be a time.') };
    case 'interval':
      return { kind, everyMinutes: readCount(fields, 'everyMinutes') };
    case 'daily':
      return { kind, time: readId(fields, 'time'), weekdays: readWeekdays(fields) };
    case 'webhook':
      return {
        kind,
        signature: readSignature(fields.signature),
        replayKey: readNullableText(fields, 'replayKey', MAX_ID),
      };
  }
}

function readScheduleTarget(value: unknown): ScheduleTarget | null {
  if (value === null || value === undefined) return null;
  const fields = readObject(value, 'target');
  if (readChoice(fields, 'kind', TARGET_KINDS) === 'task') {
    return { kind: 'task', taskId: readId(fields, 'taskId') };
  }
  return {
    kind: 'new_task',
    repoId: readNullableId(fields, 'repoId'),
    priority: fields.priority === undefined ? 'normal' : readChoice(fields, 'priority', PRIORITIES),
    mode: fields.mode === undefined ? 'build' : readChoice(fields, 'mode', MODES),
  };
}

function readScheduleSource(value: unknown): ScheduleSource | null {
  if (value === null || value === undefined) return null;
  const fields = readObject(value, 'source');
  readKnownKeys(fields, ['projectId', 'server'], 'A source');
  return { projectId: readId(fields, 'projectId'), server: readText(fields, 'server', MAX_ID) };
}

function readScheduleWrite(fields: Fields): UserCommand {
  return {
    type: 'schedule.write',
    scheduleId: readNullableId(fields, 'scheduleId'),
    name: readNullableText(fields, 'name', MAX_ID),
    text: readNullableText(fields, 'text'),
    trigger: readTrigger(fields.trigger),
    target: readScheduleTarget(fields.target),
    source: readScheduleSource(fields.source),
    enabled: fields.enabled === null || fields.enabled === undefined ? null : readBoolean(fields, 'enabled'),
    maxRuns: fields.maxRuns === null || fields.maxRuns === undefined ? null : readCount(fields, 'maxRuns'),
    timeZone: readId(fields, 'timeZone'),
  };
}

function readWatchSourceWrite(fields: Fields): UserCommand {
  return {
    type: 'watch_source.write',
    projectId: readId(fields, 'projectId'),
    server: readText(fields, 'server', MAX_ID),
    data: readText(fields, 'data', MAX_NOTE),
    repoIds: fields.repoIds === undefined ? [] : readList(fields, 'repoIds', readId),
  };
}

function readWatchdogConnect(fields: Fields): UserCommand {
  return {
    type: 'watchdog.connect',
    taskId: readId(fields, 'taskId'),
    watchdogId: readId(fields, 'watchdogId'),
    server: readText(fields, 'server', MAX_ID),
    data: readText(fields, 'data', MAX_NOTE),
  };
}

function readMemoryWrite(fields: Fields): UserCommand {
  return {
    type: 'memory.write',
    memoryId: readNullableId(fields, 'memoryId'),
    projectId: readNullableId(fields, 'projectId'),
    text: readText(fields, 'text'),
  };
}

function readFeedbackWrite(fields: Fields): UserCommand {
  return {
    type: 'feedback.write',
    feedbackId: readNullableId(fields, 'feedbackId'),
    note: readText(fields, 'note', MAX_FEEDBACK),
  };
}

function readFeedbackUpdate(fields: Fields): UserCommand {
  return {
    type: 'feedback.update',
    feedbackId: readId(fields, 'feedbackId'),
    title: readText(fields, 'title', MAX_FEEDBACK),
    body: readText(fields, 'body', MAX_FEEDBACK),
  };
}

const READERS: Record<UserCommand['type'], (fields: Fields) => UserCommand> = {
  'repo.update': (fields) => ({
    type: 'repo.update',
    repoId: readId(fields, 'repoId'),
    patch: readRepoPatch(fields.patch),
  }),
  'repo.remove': (fields) => ({ type: 'repo.remove', repoId: readId(fields, 'repoId') }),
  'project.write': (fields) => ({ type: 'project.write', project: readProject(fields.project) }),
  'project.remove': (fields) => ({ type: 'project.remove', projectId: readId(fields, 'projectId') }),
  'focus.change': readFocusChange,
  'settings.change': (fields) => ({ type: 'settings.change', patch: readSettingsPatch(fields.patch) }),
  'task.create': readTaskCreate,
  'task.prioritize': readTaskPrioritize,
  'task.wait_on': readTaskWaitOn,
  'task.stack_on': readTaskStackOn,
  'task.move_to_backlog': (fields) => ({ type: 'task.move_to_backlog', taskId: readId(fields, 'taskId') }),
  'task.remove_from_backlog': (fields) => ({
    type: 'task.remove_from_backlog',
    taskId: readId(fields, 'taskId'),
  }),
  'task.snooze': (fields) => ({ type: 'task.snooze', taskId: readId(fields, 'taskId') }),
  'task.unsnooze': (fields) => ({ type: 'task.unsnooze', taskId: readId(fields, 'taskId') }),
  'task.cancel': (fields) => ({ type: 'task.cancel', taskId: readId(fields, 'taskId') }),
  'task.mark_duplicate': (fields) => ({
    type: 'task.mark_duplicate',
    taskId: readId(fields, 'taskId'),
    duplicateOf: readId(fields, 'duplicateOf'),
  }),
  'task.clear_duplicate': (fields) => ({ type: 'task.clear_duplicate', taskId: readId(fields, 'taskId') }),
  'task.complete': (fields) => ({ type: 'task.complete', taskId: readId(fields, 'taskId') }),
  'task.retry': readRetry,
  'task.message': readTaskMessage,
  'round.ship': readRoundShip,
  'round.update': readRoundUpdate,
  'round.remove': (fields) => ({
    type: 'round.remove',
    taskId: readId(fields, 'taskId'),
    number: readCount(fields, 'number'),
  }),
  'round.send': (fields) => ({
    type: 'round.send',
    taskId: readId(fields, 'taskId'),
    number: readCount(fields, 'number'),
  }),
  'gate.answer': readGateAnswer,
  'merge_step.tick': readMergeStepTick,
  'suggestion.accept': readSuggestionAccept,
  'suggestion.dismiss': readSuggestionDismiss,
  'suggestion.keep': readSuggestionKeep,
  'monitor.check_in_now': (fields) => ({ type: 'monitor.check_in_now', taskId: readId(fields, 'taskId') }),
  'run.snooze_silence': readSnooze,
  'run.dismiss_silence': (fields) => ({ type: 'run.dismiss_silence', runId: readId(fields, 'runId') }),
  'task.bind_account': readAccountBinding,
  'usage_wait.change': readUsageWaitChange,
  'usage_wait.resume_now': (fields) => ({ type: 'usage_wait.resume_now', taskId: readId(fields, 'taskId') }),
  'delegation.cancel': (fields) => ({ type: 'delegation.cancel', runId: readId(fields, 'runId') }),
  'schedule.enable': readScheduleEnable,
  'schedule.remove': (fields) => ({ type: 'schedule.remove', scheduleId: readId(fields, 'scheduleId') }),
  'schedule.write': readScheduleWrite,
  'watch_suggestion.accept': (fields) => ({
    type: 'watch_suggestion.accept',
    suggestionId: readId(fields, 'suggestionId'),
  }),
  'watch_suggestion.dismiss': (fields) => ({
    type: 'watch_suggestion.dismiss',
    suggestionId: readId(fields, 'suggestionId'),
  }),
  'watchdog.stop': (fields) => ({
    type: 'watchdog.stop',
    taskId: readId(fields, 'taskId'),
    watchdogId: readId(fields, 'watchdogId'),
  }),
  'watchdog.connect': readWatchdogConnect,
  'watch_source.write': readWatchSourceWrite,
  'watch_source.remove': (fields) => ({
    type: 'watch_source.remove',
    projectId: readId(fields, 'projectId'),
    server: readText(fields, 'server', MAX_ID),
  }),
  'memory.write': readMemoryWrite,
  'memory.accept': (fields) => ({ type: 'memory.accept', memoryId: readId(fields, 'memoryId') }),
  'memory.remove': (fields) => ({ type: 'memory.remove', memoryId: readId(fields, 'memoryId') }),
  'feedback.write': readFeedbackWrite,
  'feedback.update': readFeedbackUpdate,
  'feedback.file': (fields) => ({ type: 'feedback.file', feedbackId: readId(fields, 'feedbackId') }),
  'feedback.dismiss': (fields) => ({ type: 'feedback.dismiss', feedbackId: readId(fields, 'feedbackId') }),
  'task.share': (fields) => ({
    type: 'task.share',
    taskId: readId(fields, 'taskId'),
    ...('limit' in fields ? { limit: readChoice(fields, 'limit', SHARE_LIMIT_SET) } : {}),
    ...('preset' in fields ? { preset: readChoice(fields, 'preset', SHARE_PRESET_SET) } : {}),
  }),
  'task.unshare': (fields) => ({ type: 'task.unshare', taskId: readId(fields, 'taskId') }),
};

export const USER_COMMAND_TYPES = Object.keys(READERS) as UserCommand['type'][];

export function isUserCommandType(type: unknown): type is UserCommand['type'] {
  return typeof type === 'string' && Object.hasOwn(READERS, type);
}

export function parseUserCommand(body: unknown): UserCommand {
  const fields = readObject(body, 'A command');
  if (!isUserCommandType(fields.type)) throw new DomainError('command_forbidden', 'Unknown command.');
  return READERS[fields.type](fields);
}
