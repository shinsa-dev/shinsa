import {
  type AccountsSnapshot,
  type AgentProviderInfo,
  type CompactionMode,
  listAgentProviders,
  type Repo,
  resolveCompaction,
  resolveIdleCompaction,
  resolveRepoWorkspace,
  type Settings,
  type UsageRate,
} from '@shinsa/core';
import { ACCOUNT_LABEL } from '@/lib/accounts/account.ts';
import {
  listSwitchItems,
  needsSnoozeSetting,
  OTHER_PERCENT,
  RESUME_ITEMS,
  resolveResumeValue,
  resolveSnoozeValue,
  resolveSwitchValue,
  SNOOZE_ITEMS,
  SNOOZE_TITLE,
} from '@/lib/accounts/limits.ts';
import { type Command, type CommandSection, RANK } from '@/lib/command/registry.ts';
import { restartOnboarding } from '@/lib/connection/onboarding.ts';
import type { WorkspaceSupportMap } from '@/lib/connection/workspaces.ts';
import { applyDesktopChannel, type UpdateChannel } from '@/lib/desktop.ts';
import { EXTENSION_ICON, EXTENSION_SECTION } from '@/lib/extensions.ts';
import { updateNotifications } from '@/lib/notifications/settings.ts';
import {
  EXPLORER_SIDE_TITLE,
  EXPLORER_SIDES,
  type ExplorerSide,
  writeExplorerSide,
} from '@/lib/preferences/code.ts';
import type { AlertPreference, NotificationPreferences, SoundId } from '@/lib/preferences/notifications.ts';
import {
  AGENT_GROUPS,
  AGENT_ROLES,
  type AgentGroup,
  ALERT_ITEMS,
  COMPACTION_MODE_ITEMS,
  COST_LIMIT_TITLE,
  CUSTOM_DELEGATION_LIMIT,
  DELEGATION_LIMIT_TITLE,
  describeGroupSelects,
  describeRoleSelects,
  FIX_ROUND_ITEMS,
  FOLDERS_TITLE,
  listAgentModelItems,
  listAttentionItems,
  listBudgetItems,
  listCompactionItems,
  listDelegationLimitItems,
  listGroupModelItems,
  listGroupSpeedItems,
  listSpeedItems,
  listUsageLimitItems,
  MERGE_ITEMS,
  MODELS_TITLE,
  needsCostLimit,
  PLAN_ITEMS,
  parseBudget,
  parseCompaction,
  parseDelegationLimit,
  parseFixRounds,
  parseUsageLimit,
  resolveAgentModelPatch,
  resolveAgentModelValue,
  resolveAgentSpeedPatch,
  resolveAttentionValue,
  resolveBudgetValue,
  resolveCompactionValue,
  resolveDelegationLimitValue,
  resolveFixRoundValue,
  resolveGroupModel,
  resolveGroupModelPatch,
  resolveGroupSpeed,
  resolveGroupSpeedPatch,
  resolvePlanValue,
  resolveSectionId,
  resolveSpeedAvailability,
  resolveSpeedValue,
  resolveUsageLimitValue,
  type SettingItem,
  SOUND_ITEMS,
  USAGE_LIMIT_TITLE,
  updateSettings,
} from '@/lib/settings.ts';
import {
  findSettingsTab,
  resolveSectionRank,
  resolveSectionTab,
  resolveSettingsPath,
  resolveSettingsTab,
} from '@/lib/settings-tabs.ts';
import {
  CANARY_DOWNLOAD_URL,
  isChannelFixed,
  parseUpdateChannel,
  UPDATE_CHANNEL_ITEMS,
  UPDATES_LABEL,
} from '@/lib/updates.ts';
import { VERSIONS_SECTION } from '@/lib/versions.ts';
import { changeWorkspace, listWorkspaceItems, WORKSPACE_TITLE } from '@/lib/workspaces.ts';
import { navigate } from '@/router.ts';

const SECTIONS: { title: string; icon: Command['icon']; keywords: string[] }[] = [
  { title: 'Attention', icon: 'IconInboxEmpty', keywords: ['decisions', 'queue'] },
  { title: 'Notifications', icon: 'IconBell', keywords: ['sound', 'chime', 'alert', 'badge'] },
  {
    title: MODELS_TITLE,
    icon: 'IconRobot',
    keywords: [
      'agents',
      'task agents',
      'quick jobs',
      'providers',
      'opus',
      'sonnet',
      'codex',
      'agent',
      'reviewer',
      'answerer',
      'investigator',
      'researcher',
      'classifier',
      'writer',
      'fast mode',
      'speed',
    ],
  },
  {
    title: 'Context',
    icon: 'IconMinimize',
    keywords: ['compaction', 'compact', 'eunoe', 'fold', 'idle sessions', 'context window'],
  },
  { title: 'Engine', icon: 'IconToolbox', keywords: ['plans', 'fix rounds', 'delegations', 'merge'] },
  {
    title: VERSIONS_SECTION,
    icon: 'IconArrowDown',
    keywords: ['update', 'upgrade', 'claude code', 'codex', 'cli', 'sdk', 'latest'],
  },
  {
    title: ACCOUNT_LABEL.section,
    icon: 'IconGauge',
    keywords: [
      'agent usage',
      'claude',
      'sign in',
      'login',
      'default account',
      'usage',
      'quota',
      'reset',
      'codex',
      'chatgpt',
    ],
  },
  {
    title: 'Limits',
    icon: 'IconHourglass',
    keywords: ['switch accounts', 'resume', 'usage limit', 'weekly', 'cost limit', 'budget'],
  },
  { title: 'Schedules', icon: 'IconClock', keywords: ['webhooks', 'triggers', 'repeat', 'daily'] },
  {
    title: EXTENSION_SECTION.servers,
    icon: EXTENSION_ICON.servers,
    keywords: ['mcp', 'tools', 'integrations', 'connect', 'sign in'],
  },
  {
    title: EXTENSION_SECTION.plugins,
    icon: EXTENSION_ICON.plugins,
    keywords: ['claude code', 'hooks', 'integrations'],
  },
  {
    title: EXTENSION_SECTION.skills,
    icon: EXTENSION_ICON.skills,
    keywords: ['claude code', 'codex', 'integrations', 'tokens'],
  },
  {
    title: FOLDERS_TITLE,
    icon: 'IconFolder1',
    keywords: ['folders', 'roots', 'repositories', 'where your code lives', 'find folders'],
  },
  {
    title: 'Projects',
    icon: 'IconLayersTwo',
    keywords: [
      'repositories',
      'repos',
      'folders',
      'keys',
      'colours',
      'where agents work',
      'worktrees',
      'gitbutler',
      'checkout',
    ],
  },
  { title: 'Appearance', icon: 'IconSun', keywords: ['theme', 'layout', 'dark', 'light'] },
  { title: 'Setup', icon: 'IconArrowRotateClockwise', keywords: ['onboarding', 'setup steps'] },
];

const SAVED = 'Saved.';

export function openSettingsSection(title: string) {
  const tab = resolveSectionTab(title);
  const onTab =
    location.pathname === '/settings' && resolveSettingsTab(readTabParam(), location.hash) === tab;
  const section = onTab ? document.getElementById(resolveSectionId(title)) : null;
  if (section) section.scrollIntoView({ block: 'start', behavior: 'smooth' });
  else navigate(resolveSettingsPath(tab, title));
}

function readTabParam() {
  return new URLSearchParams(location.search).get('tab');
}

function settingChoice(
  id: string,
  label: string,
  items: readonly SettingItem<string>[],
  value: string,
  pick: (value: string) => void,
  searchOnly = false
): Command {
  const current = items.find((item) => item.value === value);
  return {
    kind: 'choice',
    id: `settings.${id}`,
    label,
    hint: current?.label,
    icon: current?.icon,
    keywords: ['setting', label],
    heading: label,
    value,
    options: items.map((item) => ({
      value: item.value,
      label: item.label,
      icon: item.icon,
      ...(item.disabled === undefined ? {} : { disabled: item.disabled }),
    })),
    pick,
    ...(searchOnly ? { searchOnly } : {}),
  };
}

function listGroupRoles(group: AgentGroup) {
  return group.roles.map(({ role }) => role);
}

function patchSettings(next: Partial<Settings> | null) {
  if (next) void updateSettings(next, SAVED);
}

function listJumpCommands(): Command[] {
  return [...SECTIONS]
    .sort((a, b) => resolveSectionRank(a.title) - resolveSectionRank(b.title))
    .map((section) => ({
      kind: 'run',
      id: `settings.section.${section.title.toLowerCase()}`,
      label: section.title,
      icon: section.icon,
      hint: findSettingsTab(resolveSectionTab(section.title)).label,
      keywords: ['section', 'scroll', ...section.keywords],
      run: () => openSettingsSection(section.title),
    }));
}

function listAttentionChoices(settings: Settings, notifications: NotificationPreferences): Command[] {
  return [
    settingChoice(
      'attention',
      'Decisions up now',
      listAttentionItems(settings),
      resolveAttentionValue(settings),
      (value) => patchSettings({ attentionLimit: Number(value) })
    ),
    settingChoice(
      'sound',
      'Play a sound',
      ALERT_ITEMS,
      notifications.sound,
      (value) => void updateNotifications({ sound: value as AlertPreference })
    ),
    settingChoice(
      'sound-id',
      'Sound',
      SOUND_ITEMS,
      notifications.soundId,
      (value) => void updateNotifications({ soundId: value as SoundId })
    ),
    settingChoice(
      'notify',
      'Show a notification',
      ALERT_ITEMS,
      notifications.notify,
      (value) => void updateNotifications({ notify: value as AlertPreference })
    ),
  ];
}

function listWorkflowChoices(settings: Settings): Command[] {
  const choices = [
    settingChoice('plans', 'Approve plans', PLAN_ITEMS, resolvePlanValue(settings), (value) =>
      patchSettings({ approvePlans: value === 'large' })
    ),
    settingChoice(
      'fix-rounds',
      'Automatic fix rounds',
      FIX_ROUND_ITEMS,
      resolveFixRoundValue(settings),
      (value) => patchSettings({ maxFixRounds: parseFixRounds(value) })
    ),
    settingChoice(
      'delegation-limit',
      DELEGATION_LIMIT_TITLE,
      listDelegationLimitItems(settings).filter((item) => item.value !== CUSTOM_DELEGATION_LIMIT),
      resolveDelegationLimitValue(settings),
      (value) => patchSettings({ delegationLimit: parseDelegationLimit(value) })
    ),
    settingChoice('merge', 'Merge with', MERGE_ITEMS, settings.mergeMethod, (value) =>
      patchSettings({ mergeMethod: value as Settings['mergeMethod'] })
    ),
    settingChoice(
      'compaction.mode',
      'Compaction',
      COMPACTION_MODE_ITEMS,
      resolveCompaction(settings),
      (value) => patchSettings({ compaction: value as CompactionMode })
    ),
  ];
  if (!resolveIdleCompaction(settings, listAgentProviders(settings)).available) return choices;
  return [
    ...choices,
    settingChoice(
      'compaction',
      'Compact idle sessions',
      listCompactionItems(settings),
      resolveCompactionValue(settings),
      (value) => patchSettings(parseCompaction(value))
    ),
  ];
}

function listGroupChoices(
  settings: Settings,
  providers: AgentProviderInfo[],
  snapshot: AccountsSnapshot | null
) {
  return AGENT_GROUPS.flatMap((group) => {
    const labels = describeGroupSelects(group);
    const availability = resolveSpeedAvailability(snapshot, settings, listGroupRoles(group));
    return [
      settingChoice(
        `model.${group.id}`,
        labels.model,
        listGroupModelItems(providers, settings, group),
        resolveGroupModel(settings, group),
        (next) => patchSettings(resolveGroupModelPatch(settings, group, next))
      ),
      settingChoice(
        `speed.${group.id}`,
        labels.speed,
        listGroupSpeedItems(settings, group, availability),
        resolveGroupSpeed(settings, group, availability),
        (next) => patchSettings(resolveGroupSpeedPatch(settings, group, next))
      ),
    ];
  });
}

function listRoleChoices(
  settings: Settings,
  providers: AgentProviderInfo[],
  snapshot: AccountsSnapshot | null
) {
  return AGENT_ROLES.flatMap((entry) => {
    const { role } = entry;
    const labels = describeRoleSelects(entry);
    const model = resolveAgentModelValue(settings, role);
    const availability = resolveSpeedAvailability(snapshot, settings, [role]);
    return [
      settingChoice(
        `model.${role}`,
        labels.model,
        listAgentModelItems(providers, model),
        model,
        (next) => patchSettings(resolveAgentModelPatch(settings, role, next)),
        true
      ),
      settingChoice(
        `speed.${role}`,
        labels.speed,
        listSpeedItems(availability),
        resolveSpeedValue(settings, role, availability),
        (next) => patchSettings(resolveAgentSpeedPatch(settings, role, next)),
        true
      ),
    ];
  });
}

function listUsageChoices(
  settings: Settings,
  snapshot: AccountsSnapshot | null,
  rates: Map<string, UsageRate | null> | null
): Command[] {
  const choices = [
    settingChoice(
      'usage-limit',
      USAGE_LIMIT_TITLE,
      listUsageLimitItems(settings),
      resolveUsageLimitValue(settings),
      (value) => patchSettings({ taskUsageLimit: parseUsageLimit(value) })
    ),
  ];
  if (needsCostLimit(settings, snapshot?.accounts ?? null, rates)) {
    choices.push(
      settingChoice(
        'budget',
        COST_LIMIT_TITLE,
        listBudgetItems(settings),
        resolveBudgetValue(settings),
        (value) => patchSettings({ taskBudgetUsd: parseBudget(value) })
      )
    );
  }
  choices.push(
    settingChoice(
      'switch-at',
      'Switch accounts at',
      listSwitchItems(settings).filter((item) => item.value !== OTHER_PERCENT),
      resolveSwitchValue(settings),
      (value) => patchSettings({ accountSwitchAt: Number(value) })
    ),
    settingChoice('resume', 'After a usage limit', RESUME_ITEMS, resolveResumeValue(settings), (value) =>
      patchSettings({ autoResume: value === 'auto' })
    )
  );
  if (needsSnoozeSetting(settings)) {
    choices.push(
      settingChoice('snooze', SNOOZE_TITLE, SNOOZE_ITEMS, resolveSnoozeValue(settings), (value) =>
        patchSettings({ snoozeLimited: value === 'on' })
      )
    );
  }
  return choices;
}

export interface WorkspaceChoices {
  repos: Repo[];
  support: WorkspaceSupportMap | null;
}

function listWorkspaceChoices({ repos, support }: WorkspaceChoices): Command[] {
  return [...repos]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((repo) => {
      const choice = settingChoice(
        `workspace.${repo.id}`,
        `${WORKSPACE_TITLE} in ${repo.name}`,
        listWorkspaceItems(repo, support),
        resolveRepoWorkspace(repo),
        (value) => void changeWorkspace(repo, value as Parameters<typeof changeWorkspace>[1]),
        true
      );
      return { ...choice, keywords: [...(choice.keywords ?? []), 'worktrees', 'gitbutler', 'main checkout'] };
    });
}

function listChannelChoices(channel: UpdateChannel | null): Command[] {
  if (!channel || isChannelFixed(channel)) return [];
  return [
    settingChoice('update-channel', UPDATES_LABEL.channel, UPDATE_CHANNEL_ITEMS, channel, (value) =>
      applyDesktopChannel(parseUpdateChannel(value))
    ),
  ];
}

function listCanaryCommands(channel: UpdateChannel | null): Command[] {
  if (!channel || isChannelFixed(channel)) return [];
  return [
    {
      kind: 'link',
      id: 'settings.canary.download',
      label: UPDATES_LABEL.downloadCanary,
      icon: 'IconArrowUpRight',
      keywords: ['canary', 'update channel', 'main', 'nightly', 'install'],
      href: CANARY_DOWNLOAD_URL,
    },
  ];
}

export function listSettingsSections(
  settings: Settings,
  providers: AgentProviderInfo[],
  notifications: NotificationPreferences,
  snapshot: AccountsSnapshot | null = null,
  workspaces: WorkspaceChoices = { repos: [], support: null },
  explorerSide: ExplorerSide = 'left',
  updateChannel: UpdateChannel | null = null,
  rates: Map<string, UsageRate | null> | null = null
): CommandSection[] {
  return [
    { id: 'settings.sections', heading: 'Jump to', rank: RANK.context, commands: listJumpCommands() },
    {
      id: 'settings.values',
      heading: 'Change a setting',
      rank: RANK.context + 1,
      commands: [
        ...listAttentionChoices(settings, notifications),
        ...listWorkflowChoices(settings),
        ...listGroupChoices(settings, providers, snapshot),
        ...listRoleChoices(settings, providers, snapshot),
        ...listUsageChoices(settings, snapshot, rates),
        ...listWorkspaceChoices(workspaces),
        settingChoice('explorer-side', EXPLORER_SIDE_TITLE, EXPLORER_SIDES, explorerSide, (value) =>
          writeExplorerSide(value === 'right' ? 'right' : 'left')
        ),
        ...listChannelChoices(updateChannel),
      ],
    },
    {
      id: 'settings.setup',
      heading: 'Setup',
      rank: RANK.context + 2,
      commands: [
        {
          kind: 'run',
          id: 'settings.setup.restart',
          label: 'Run setup again',
          icon: 'IconArrowRotateClockwise',
          keywords: ['onboarding', 'setup steps', 'folders', 'start over'],
          run: () => void restartOnboarding(),
        },
        ...listCanaryCommands(updateChannel),
      ],
    },
  ];
}
