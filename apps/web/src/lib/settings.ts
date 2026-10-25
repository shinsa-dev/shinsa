import {
  type AccountSummary,
  type AccountsSnapshot,
  type AgentProviderInfo,
  type AgentRole,
  type CompactionMode,
  describeUsd,
  type FastModeAvailability,
  listAgentProviders,
  RUN_AGENT_ROLE,
  type RunRole,
  resolveAgentFastMode,
  resolveAgentModel,
  resolveAgentProvider,
  resolveAttentionLimit,
  resolveFastModeAvailability,
  resolveIdleCompaction,
  resolveModelLabel,
  resolveProviderLabel,
  resolveWeeklyPercent,
  type Settings,
} from '@shinsa/core';
import type { MenuItemIcon } from '@shinsa/ui/components/menu-icon';
import { resolveProviderIcon } from '@/lib/accounts/account.ts';
import { sendCommandWithToast } from '@/lib/connection/commands.ts';
import { resolveToggledRoots } from '@/lib/onboarding.ts';
import type { AlertPreference, SoundId } from '@/lib/preferences/notifications.ts';

export interface SettingItem<Value extends string> {
  value: Value;
  label: string;
  icon?: MenuItemIcon;
  hint?: string;
  disabled?: string;
  group?: string;
}

export function updateSettings(patch: Partial<Settings>, done?: string) {
  return sendCommandWithToast({ type: 'settings.change', patch }, done);
}

export interface AgentRoleEntry {
  role: AgentRole;
  title: string;
  description: string;
}

export interface FollowingRoleEntry {
  role: RunRole;
  title: string;
  description: string;
  follows: AgentRoleEntry;
}

export interface AgentGroup {
  id: string;
  title: string;
  description: string;
  roles: AgentRoleEntry[];
  following: FollowingRoleEntry[];
}

const TASK_ROLES: AgentRoleEntry[] = [
  {
    role: 'agent',
    title: 'Agent',
    description: 'Plans, builds and fixes each round in one conversation, and runs its operation.',
  },
  { role: 'reviewer', title: 'Reviewer', description: 'Checks the changes before you see them.' },
  { role: 'answerer', title: 'Answerer', description: 'Answers questions about your code.' },
];

function followRole(role: RunRole, title: string, description: string): FollowingRoleEntry {
  const follows = TASK_ROLES.find((entry) => entry.role === RUN_AGENT_ROLE[role]) as AgentRoleEntry;
  return { role, title, description, follows };
}

export const AGENT_GROUPS: AgentGroup[] = [
  {
    id: 'task',
    title: 'Task agents',
    description:
      'They plan, build, review and fix the work, answer questions, investigate problems, do research and run operations.',
    roles: TASK_ROLES,
    following: [
      followRole('investigator', 'Investigator', 'Finds the cause of a problem.'),
      followRole('researcher', 'Researcher', 'Looks into a question and writes a report.'),
    ],
  },
  {
    id: 'quick',
    title: 'Quick jobs',
    description: 'They sort new tasks and your messages, and write the guide on Home.',
    roles: [
      {
        role: 'classifier',
        title: 'Classifier',
        description: 'Names and sorts each new task and your messages.',
      },
      { role: 'writer', title: 'Writer', description: 'Writes the guide on Home.' },
    ],
    following: [],
  },
];

export const AGENT_ROLES: AgentRoleEntry[] = AGENT_GROUPS.flatMap((group) => group.roles);

export function describeFollowedRole(entry: FollowingRoleEntry) {
  return `Follows the ${entry.follows.title.toLowerCase()}`;
}

export interface AgentSelectLabels {
  model: string;
  speed: string;
}

export function describeGroupSelects(group: AgentGroup): AgentSelectLabels {
  const name = group.title.toLowerCase();
  return { model: `Model for ${name}`, speed: `Speed for ${name}` };
}

export function describeRoleSelects(entry: AgentRoleEntry): AgentSelectLabels {
  return { model: `${entry.title} model`, speed: `${entry.title} speed` };
}

export const MIXED_VALUE = 'mixed';

const MIXED_ITEM: SettingItem<string> = { value: MIXED_VALUE, label: 'Set per role', icon: 'IconLayersTwo' };

const ATTENTION_LIMITS = [1, 2, 3, 5];

function createAttentionItem(limit: number): SettingItem<string> {
  return {
    value: String(limit),
    label: limit === 1 ? 'One at a time' : `${limit} at a time`,
    icon: 'IconInboxEmpty',
  };
}

export function listAttentionItems(settings: Settings): SettingItem<string>[] {
  const current = resolveAttentionLimit(settings);
  const limits = ATTENTION_LIMITS.includes(current)
    ? ATTENTION_LIMITS
    : [...ATTENTION_LIMITS, current].sort((a, b) => a - b);
  return limits.map(createAttentionItem);
}

export const PLAN_ITEMS: SettingItem<string>[] = [
  { value: 'never', label: 'When you ask', icon: 'IconArrowRight' },
  { value: 'large', label: 'Large tasks', icon: 'IconCheckCircle2' },
];

export const FIX_ROUND_ITEMS: SettingItem<string>[] = [
  { value: 'endless', label: 'Until clean', icon: 'IconInfinity' },
  ...['1', '2', '3', '5', '10'].map((value) => ({
    value,
    label: value === '1' ? '1 round' : `${value} rounds`,
    icon: 'IconArrowsRepeat' as const,
  })),
];

export const MERGE_ITEMS: SettingItem<Settings['mergeMethod']>[] = [
  { value: 'squash', label: 'Squash', icon: 'IconCommits' },
  { value: 'merge', label: 'Merge commit', icon: 'IconMerged' },
  { value: 'rebase', label: 'Rebase', icon: 'IconBranch' },
];

const BUDGETS = [1, 2, 5, 10, 20];

function createBudgetItem(limit: number): SettingItem<string> {
  return { value: String(limit), label: `${describeUsd(limit)} per task`, icon: 'IconCoins' };
}

export function listBudgetItems(settings: Settings): SettingItem<string>[] {
  const current = settings.taskBudgetUsd ?? null;
  const limits =
    current === null || BUDGETS.includes(current) ? BUDGETS : [...BUDGETS, current].sort((a, b) => a - b);
  return [{ value: 'off', label: 'No limit', icon: 'IconInfinity' }, ...limits.map(createBudgetItem)];
}

export function resolveBudgetValue(settings: Settings) {
  return settings.taskBudgetUsd == null ? 'off' : String(settings.taskBudgetUsd);
}

export function parseBudget(value: string) {
  return value === 'off' ? null : Number(value);
}

export const FOLDERS_TITLE = 'Repository folders';

export const MODELS_TITLE = 'Models';

export interface RootsChange {
  roots: string[];
  done: string;
}

const FOLDER_DONE = { added: 'Folder added.', removed: 'Folder removed.' };

export function resolveRootAdded(configured: string[], path: string): RootsChange {
  return { roots: [...configured, path.trim()], done: FOLDER_DONE.added };
}

export function resolveRootRemoved(configured: string[], path: string): RootsChange {
  return { roots: configured.filter((root) => root !== path), done: FOLDER_DONE.removed };
}

export function resolveRootToggled(configured: string[], path: string): RootsChange {
  const done = configured.includes(path) ? FOLDER_DONE.removed : FOLDER_DONE.added;
  return { roots: resolveToggledRoots(configured, path), done };
}

export const USAGE_LIMIT_TITLE = 'Usage limit per task';

export const COST_LIMIT_TITLE = 'Cost limit per task';

export function needsCostLimit(settings: Settings, accounts: AccountSummary[] | null) {
  if (settings.taskBudgetUsd != null) return true;
  return accounts !== null && !accounts.some((account) => resolveWeeklyPercent(account.usage) !== null);
}

const USAGE_LIMITS = [5, 10, 20, 30, 50];

function createUsageLimitItem(limit: number): SettingItem<string> {
  return { value: String(limit), label: `${limit}% of the weekly limit`, icon: 'IconGauge' };
}

export function listUsageLimitItems(settings: Settings): SettingItem<string>[] {
  const current = settings.taskUsageLimit ?? null;
  const limits =
    current === null || USAGE_LIMITS.includes(current)
      ? USAGE_LIMITS
      : [...USAGE_LIMITS, current].sort((a, b) => a - b);
  return [{ value: 'off', label: 'No limit', icon: 'IconInfinity' }, ...limits.map(createUsageLimitItem)];
}

export function resolveUsageLimitValue(settings: Settings) {
  return settings.taskUsageLimit == null ? 'off' : String(settings.taskUsageLimit);
}

export function parseUsageLimit(value: string) {
  return value === 'off' ? null : Number(value);
}

export function resolveAttentionValue(settings: Settings) {
  return String(resolveAttentionLimit(settings));
}

export function resolvePlanValue(settings: Settings) {
  return settings.approvePlans ? 'large' : 'never';
}

export function resolveFixRoundValue(settings: Settings) {
  return settings.maxFixRounds === null ? 'endless' : String(settings.maxFixRounds);
}

export function parseFixRounds(value: string) {
  return value === 'endless' ? null : Number(value);
}

const MODEL_KEY_SEPARATOR = ':';

function resolveModelKey(provider: string, model: string) {
  return `${provider}${MODEL_KEY_SEPARATOR}${model}`;
}

function parseModelKey(key: string) {
  const at = key.indexOf(MODEL_KEY_SEPARATOR);
  return { provider: key.slice(0, at), model: key.slice(at + 1) };
}

export function resolveAgentModelValue(settings: Settings, role: AgentRole) {
  return resolveModelKey(resolveAgentProvider(settings, role), resolveAgentModel(settings, role));
}

export function listAgentModelItems(
  providers: AgentProviderInfo[],
  current: string | null
): SettingItem<string>[] {
  const items: SettingItem<string>[] = providers.flatMap((entry) =>
    entry.models.map((option) => ({
      value: resolveModelKey(entry.id, option.id),
      label: option.label,
      icon: resolveProviderIcon(entry.id),
      group: entry.label,
    }))
  );
  if (current === null || items.some((item) => item.value === current)) return items;
  const { provider, model } = parseModelKey(current);
  const group = resolveProviderLabel(provider);
  const extra = {
    value: current,
    label: resolveModelLabel(model),
    icon: resolveProviderIcon(provider),
    group,
  };
  const at = items.findIndex((item) => item.group === group);
  return at === -1 ? [extra, ...items] : [...items.slice(0, at), extra, ...items.slice(at)];
}

export function resolveAgentModelPatch(settings: Settings, role: AgentRole, key: string): Partial<Settings> {
  const { provider, model } = parseModelKey(key);
  return {
    agentProviders: { ...settings.agentProviders, [role]: provider },
    agentModels: { ...settings.agentModels, [role]: model },
  };
}

function resolveShared(values: string[]) {
  return values.every((value) => value === values[0]) ? (values[0] ?? MIXED_VALUE) : MIXED_VALUE;
}

export function resolveGroupModel(settings: Settings, group: AgentGroup) {
  return resolveShared(group.roles.map(({ role }) => resolveAgentModelValue(settings, role)));
}

export function listGroupModelItems(providers: AgentProviderInfo[], settings: Settings, group: AgentGroup) {
  const current = resolveGroupModel(settings, group);
  if (current === MIXED_VALUE) return [MIXED_ITEM, ...listAgentModelItems(providers, null)];
  return listAgentModelItems(providers, current);
}

function assignRoles<Value>(group: AgentGroup, value: Value) {
  return Object.fromEntries(group.roles.map(({ role }) => [role, value])) as Partial<
    Record<AgentRole, Value>
  >;
}

export function resolveGroupModelPatch(
  settings: Settings,
  group: AgentGroup,
  key: string
): Partial<Settings> | null {
  if (key === MIXED_VALUE) return null;
  const { provider, model } = parseModelKey(key);
  return {
    agentProviders: { ...settings.agentProviders, ...assignRoles(group, provider) },
    agentModels: { ...settings.agentModels, ...assignRoles(group, model) },
  };
}

export function resolveSectionId(title: string) {
  return `settings-${title.toLowerCase().replace(/\s+/g, '-')}`;
}

export function resolveHashSectionId(hash: string) {
  const title = hash.replace(/^#/, '').toLowerCase();
  return title ? resolveSectionId(title) : null;
}

const COMPACTION_LEADS = [1, 2, 5, 10];

function createCompactionItem(minutes: number): SettingItem<string> {
  return {
    value: String(minutes),
    label: `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} before the cache expires`,
    icon: 'IconHourglass',
  };
}

export function listCompactionItems(settings: Settings): SettingItem<string>[] {
  const { leadMinutes } = resolveIdleCompaction(settings, listAgentProviders(settings));
  const leads = COMPACTION_LEADS.includes(leadMinutes)
    ? COMPACTION_LEADS
    : [...COMPACTION_LEADS, leadMinutes].sort((a, b) => a - b);
  return [{ value: 'off', label: 'Never', icon: 'IconPause' }, ...leads.map(createCompactionItem)];
}

export function resolveCompactionValue(settings: Settings) {
  const { enabled, leadMinutes } = resolveIdleCompaction(settings, listAgentProviders(settings));
  return enabled ? String(leadMinutes) : 'off';
}

export function parseCompaction(value: string): Partial<Settings> {
  return value === 'off'
    ? { idleCompaction: false }
    : { idleCompaction: true, compactionLeadMinutes: Number(value) };
}

export const ALERT_ITEMS: SettingItem<AlertPreference>[] = [
  { value: 'never', label: 'Never', icon: 'IconBell2Snooze' },
  { value: 'unfocused', label: 'When Shinsa is in the background', icon: 'IconWindow' },
  { value: 'always', label: 'Always', icon: 'IconBell' },
];

export const SOUND_ITEMS: SettingItem<SoundId>[] = [
  { value: 'chime', label: 'Chime', icon: 'IconBell' },
  { value: 'ping', label: 'Ping', icon: 'IconBell' },
  { value: 'pop', label: 'Pop', icon: 'IconBell' },
];

export const COMPACTION_MODE_ITEMS: SettingItem<CompactionMode>[] = [
  { value: 'eunoe_compact', label: 'Eunoe compaction', icon: 'IconMinimize' },
  { value: 'eunoe_default', label: 'Eunoe always fold', icon: 'IconLayersTwo' },
  { value: 'claude', label: 'Claude Code’s compaction', icon: 'IconBubbleText' },
  { value: 'off', label: 'Off', icon: 'IconPause' },
];

export const FAST_MODE_ITEMS: SettingItem<string>[] = [
  { value: 'off', label: 'Standard', icon: 'IconSpeedMiddle' },
  { value: 'on', label: 'Fast', icon: 'IconSpeedHigh' },
];

export const FAST_MODE_UNAVAILABLE = 'Unavailable: needs usage credits';

const FAST_MODE_HELD: SettingItem<string>[] = [
  FAST_MODE_ITEMS[0] as SettingItem<string>,
  { value: 'on', label: 'Fast', icon: 'IconSpeedHigh', disabled: FAST_MODE_UNAVAILABLE },
];

export function resolveSpeedAvailability(
  snapshot: AccountsSnapshot | null,
  settings: Settings,
  roles: readonly AgentRole[]
): FastModeAvailability {
  const states = roles.map((role) =>
    resolveFastModeAvailability(snapshot, resolveAgentProvider(settings, role))
  );
  if (states.length > 0 && states.every((state) => state === 'needs_credits')) return 'needs_credits';
  return states.includes('available') ? 'available' : 'unknown';
}

export function listSpeedItems(availability: FastModeAvailability) {
  return availability === 'needs_credits' ? FAST_MODE_HELD : FAST_MODE_ITEMS;
}

export function resolveSpeedValue(
  settings: Settings,
  role: AgentRole,
  availability: FastModeAvailability = 'unknown'
) {
  return availability !== 'needs_credits' && resolveAgentFastMode(settings, role) ? 'on' : 'off';
}

export function resolveGroupSpeed(
  settings: Settings,
  group: AgentGroup,
  availability: FastModeAvailability = 'unknown'
) {
  return resolveShared(group.roles.map(({ role }) => resolveSpeedValue(settings, role, availability)));
}

export function listGroupSpeedItems(
  settings: Settings,
  group: AgentGroup,
  availability: FastModeAvailability = 'unknown'
) {
  const items = listSpeedItems(availability);
  return resolveGroupSpeed(settings, group, availability) === MIXED_VALUE ? [MIXED_ITEM, ...items] : items;
}

export function resolveAgentSpeedPatch(
  settings: Settings,
  role: AgentRole,
  value: string
): Partial<Settings> {
  return { agentFastModes: { ...settings.agentFastModes, [role]: value === 'on' } };
}

export function resolveGroupSpeedPatch(
  settings: Settings,
  group: AgentGroup,
  value: string
): Partial<Settings> | null {
  if (value === MIXED_VALUE) return null;
  return { agentFastModes: { ...settings.agentFastModes, ...assignRoles(group, value === 'on') } };
}
