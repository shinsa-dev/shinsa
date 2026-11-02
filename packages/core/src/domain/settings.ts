import { Schema, SchemaTransformation } from 'effect';
import { AGENT_ROLES, CLAUDE_PROVIDER } from '../agent-models/index.ts';
import {
  Bool,
  Choice,
  FIELD_MESSAGES,
  FiniteNumber,
  Id,
  KnownKeys,
  List,
  OrNull,
  Strict,
  Text,
  WholeNumber,
} from './fields.ts';
import { DAY_MS, HOUR_MS } from './time.ts';
import type { AgentRole } from './types.ts';

export type MergeMethod = 'squash' | 'merge' | 'rebase';

export const MERGE_METHODS: ReadonlySet<MergeMethod> = new Set<MergeMethod>(['squash', 'merge', 'rebase']);

export type CompactionMode = 'fold' | 'compact' | 'provider' | 'off';

export const COMPACTION_MODES: ReadonlySet<CompactionMode> = new Set<CompactionMode>([
  'fold',
  'compact',
  'provider',
  'off',
]);

const DEFAULT_COMPACTION: CompactionMode = 'fold';

export type PlanApproval = 'when_asked' | 'large' | 'always';

export const PLAN_APPROVALS: ReadonlySet<PlanApproval> = new Set<PlanApproval>([
  'when_asked',
  'large',
  'always',
]);

export type ShareLimit = 'until_done' | 'hour' | 'day' | 'week' | 'none';

export const SHARE_LIMITS: readonly ShareLimit[] = ['until_done', 'hour', 'day', 'week', 'none'];

const SHARE_LIMIT_MS: Partial<Record<ShareLimit, number>> = { hour: HOUR_MS, day: DAY_MS, week: 7 * DAY_MS };

const DEFAULT_SHARE_LIMIT: ShareLimit = 'until_done';

export function resolveShareLimit(settings: Settings): ShareLimit {
  return settings.shareLimit ?? DEFAULT_SHARE_LIMIT;
}

export type SharePreset = 'status' | 'standard' | 'full';

export const SHARE_PRESETS: readonly SharePreset[] = ['status', 'standard', 'full'];

const DEFAULT_SHARE_PRESET: SharePreset = 'standard';

export function resolveSharePreset(settings: Settings): SharePreset {
  return settings.sharePreset ?? DEFAULT_SHARE_PRESET;
}

export function resolveShareEnd(limit: ShareLimit, now: number) {
  const span = SHARE_LIMIT_MS[limit];
  return span === undefined ? null : now + span;
}

export interface Settings {
  defaultProvider: string;
  defaultModel: string | null;
  maxFixRounds: number | null;
  delegationLimit?: number | null;
  mergeMethod: MergeMethod;
  attentionLimit?: number;
  approvePlans?: PlanApproval;
  agentModels?: Partial<Record<AgentRole, string>>;
  agentProviders?: Partial<Record<AgentRole, string>>;
  agentFastModes?: Partial<Record<AgentRole, boolean>>;
  taskBudgetUsd?: number | null;
  taskUsageLimit?: number | null;
  autoResume?: boolean;
  snoozeLimited?: boolean;
  accountSwitchAt?: number;
  idleCompaction?: boolean;
  compactionLeadMinutes?: number;
  compaction?: CompactionMode;
  fastMode?: boolean;
  watchdogHours?: number;
  watchdogFirstCheckMinutes?: number;
  watchdogMaxGapHours?: number;
  taskCapacity?: number | null;
  placementPolicies?: string[];
  shareLimit?: ShareLimit;
  sharePreset?: SharePreset;
}

export const SETTINGS_KEYS = [
  'defaultProvider',
  'defaultModel',
  'maxFixRounds',
  'delegationLimit',
  'mergeMethod',
  'attentionLimit',
  'approvePlans',
  'agentModels',
  'agentProviders',
  'agentFastModes',
  'taskBudgetUsd',
  'taskUsageLimit',
  'autoResume',
  'snoozeLimited',
  'accountSwitchAt',
  'idleCompaction',
  'compactionLeadMinutes',
  'compaction',
  'fastMode',
  'watchdogHours',
  'watchdogFirstCheckMinutes',
  'watchdogMaxGapHours',
  'taskCapacity',
  'placementPolicies',
  'shareLimit',
  'sharePreset',
] as const satisfies readonly (keyof Settings)[];

function RoleMap<S extends Schema.Top>(name: string, value: S) {
  return KnownKeys(name, AGENT_ROLES, (role) => `${name} has no role ${role}.`).pipe(
    Schema.decodeTo(
      Schema.Record(Schema.Literals(AGENT_ROLES), Schema.optionalKey(value)),
      SchemaTransformation.passthrough({ strict: false })
    )
  );
}

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
    agentModels: Schema.optionalKey(RoleMap('agentModels', Id())),
    agentProviders: Schema.optionalKey(RoleMap('agentProviders', Id())),
    agentFastModes: Schema.optionalKey(RoleMap('agentFastModes', Bool)),
    taskBudgetUsd: Schema.optionalKey(OrNull(FiniteNumber, FIELD_MESSAGES.number)),
    taskUsageLimit: Schema.optionalKey(OrNull(WholeNumber, FIELD_MESSAGES.wholeNumber)),
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
  } satisfies Record<(typeof SETTINGS_KEYS)[number], Schema.Top>,
  'Settings',
  'patch'
);

export type SettingsPatch = typeof SettingsPatch.Type;

export const HUMAN_ONLY_SETTINGS = [
  'approvePlans',
  'mergeMethod',
  'taskBudgetUsd',
  'taskUsageLimit',
  'autoResume',
  'snoozeLimited',
  'accountSwitchAt',
  'fastMode',
  'agentFastModes',
  'delegationLimit',
  'shareLimit',
  'sharePreset',
] as const satisfies readonly (keyof Settings)[];

export const HUMAN_ONLY_REPO_FIELDS = ['checkCommands', 'workspace', 'coverage'] as const;

const DEFAULT_MODEL = 'opus';

const DEFAULT_ATTENTION_LIMIT = 1;

const DEFAULT_ACCOUNT_SWITCH_AT = 90;

const DEFAULT_COMPACTION_LEAD_MINUTES = 2;

export const MAX_COMPACTION_LEAD_MINUTES = 30;

export const WATCHDOG_DEFAULTS = { hours: 72, firstCheckMinutes: 30, maxGapHours: 6 } as const;

export const WATCHDOG_SETTING_LIMITS = { hours: 720, firstCheckMinutes: 720, maxGapHours: 24 } as const;

export function resolveWatchdogDefaults(settings: Settings) {
  return {
    hours: settings.watchdogHours ?? WATCHDOG_DEFAULTS.hours,
    firstCheckMinutes: settings.watchdogFirstCheckMinutes ?? WATCHDOG_DEFAULTS.firstCheckMinutes,
    maxGapHours: settings.watchdogMaxGapHours ?? WATCHDOG_DEFAULTS.maxGapHours,
  };
}

const DEFAULT_SETTINGS: Settings = {
  defaultProvider: CLAUDE_PROVIDER,
  defaultModel: DEFAULT_MODEL,
  maxFixRounds: null,
  delegationLimit: null,
  mergeMethod: 'squash',
  attentionLimit: DEFAULT_ATTENTION_LIMIT,
  approvePlans: 'when_asked',
  agentModels: {},
  agentProviders: {},
  agentFastModes: {},
  taskBudgetUsd: null,
  taskUsageLimit: null,
  autoResume: true,
  snoozeLimited: true,
  accountSwitchAt: DEFAULT_ACCOUNT_SWITCH_AT,
  compactionLeadMinutes: DEFAULT_COMPACTION_LEAD_MINUTES,
  compaction: DEFAULT_COMPACTION,
  fastMode: false,
  watchdogHours: WATCHDOG_DEFAULTS.hours,
  watchdogFirstCheckMinutes: WATCHDOG_DEFAULTS.firstCheckMinutes,
  watchdogMaxGapHours: WATCHDOG_DEFAULTS.maxGapHours,
  taskCapacity: null,
  placementPolicies: [],
  shareLimit: DEFAULT_SHARE_LIMIT,
  sharePreset: DEFAULT_SHARE_PRESET,
};

export function createSettings(): Settings {
  return structuredClone(DEFAULT_SETTINGS);
}

export function resolveAttentionLimit(settings: Settings) {
  return Math.max(1, settings.attentionLimit ?? DEFAULT_ATTENTION_LIMIT);
}

export function resolveDelegationLimit(settings: Settings) {
  return settings.delegationLimit ?? null;
}

export function resolveAccountSwitchAt(settings: Settings) {
  return Math.min(100, Math.max(1, settings.accountSwitchAt ?? DEFAULT_ACCOUNT_SWITCH_AT));
}

export function resolveCompaction(settings: Settings): CompactionMode {
  return settings.compaction ?? DEFAULT_COMPACTION;
}

export function isEunoeCompaction(mode: CompactionMode) {
  return mode === 'fold' || mode === 'compact';
}

export function isFoldingCompaction(mode: CompactionMode) {
  return mode === 'fold';
}

export function resolveFastMode(settings: Settings) {
  return settings.fastMode ?? false;
}

export function resolveAgentFastMode(settings: Settings, role: AgentRole) {
  return settings.agentFastModes?.[role] ?? resolveFastMode(settings);
}

function hasNativeCompaction(settings: Settings, provider: string) {
  const mode = resolveCompaction(settings);
  return mode !== 'off' && (provider !== CLAUDE_PROVIDER || mode === 'provider');
}

export function resolveIdleCompaction(settings: Settings, providers: readonly string[]) {
  const lead = settings.compactionLeadMinutes ?? DEFAULT_COMPACTION_LEAD_MINUTES;
  const available = providers.some((provider) => hasNativeCompaction(settings, provider));
  return {
    available,
    enabled: settings.idleCompaction === true && available,
    leadMinutes: Math.min(MAX_COMPACTION_LEAD_MINUTES, Math.max(1, lead)),
  };
}
