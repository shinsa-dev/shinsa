import { CLAUDE_PROVIDER } from '../agent-models/index.ts';
import type { AgentRole } from './types.ts';

export type MergeMethod = 'squash' | 'merge' | 'rebase';

export const MERGE_METHODS: ReadonlySet<MergeMethod> = new Set<MergeMethod>(['squash', 'merge', 'rebase']);

export type CompactionMode = 'eunoe_compact' | 'eunoe_default' | 'claude' | 'off';

export const COMPACTION_MODES: ReadonlySet<CompactionMode> = new Set<CompactionMode>([
  'eunoe_compact',
  'eunoe_default',
  'claude',
  'off',
]);

const DEFAULT_COMPACTION: CompactionMode = 'eunoe_compact';

export interface Settings {
  defaultProvider: string;
  defaultModel: string | null;
  maxFixRounds: number | null;
  delegationLimit?: number | null;
  mergeMethod: MergeMethod;
  attentionLimit?: number;
  approvePlans?: boolean;
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
] as const satisfies readonly (keyof Settings)[];

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
] as const satisfies readonly (keyof Settings)[];

export const HUMAN_ONLY_REPO_FIELDS = ['checkCommands', 'checksWaived', 'workspace', 'coverage'] as const;

const DEFAULT_MODEL = 'opus';

const DEFAULT_ATTENTION_LIMIT = 1;

const DEFAULT_ACCOUNT_SWITCH_AT = 90;

const DEFAULT_COMPACTION_LEAD_MINUTES = 2;

export const MAX_COMPACTION_LEAD_MINUTES = 30;

const DEFAULT_SETTINGS: Settings = {
  defaultProvider: CLAUDE_PROVIDER,
  defaultModel: DEFAULT_MODEL,
  maxFixRounds: null,
  delegationLimit: null,
  mergeMethod: 'squash',
  attentionLimit: DEFAULT_ATTENTION_LIMIT,
  approvePlans: false,
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

export function resolveFastMode(settings: Settings) {
  return settings.fastMode ?? false;
}

export function resolveAgentFastMode(settings: Settings, role: AgentRole) {
  return settings.agentFastModes?.[role] ?? resolveFastMode(settings);
}

function hasNativeCompaction(settings: Settings, provider: string) {
  const mode = resolveCompaction(settings);
  return mode !== 'off' && (provider !== CLAUDE_PROVIDER || mode === 'claude');
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
