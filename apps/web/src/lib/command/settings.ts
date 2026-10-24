import {
  type AccountsSnapshot,
  type AgentProviderInfo,
  type CompactionMode,
  listAgentProviders,
  resolveCompaction,
  resolveIdleCompaction,
  type Settings,
} from '@shinsa/core';
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
import { EXTENSION_ICON, EXTENSION_SECTION } from '@/lib/extensions.ts';
import { updateNotifications } from '@/lib/notifications/settings.ts';
import type { AlertPreference, NotificationPreferences, SoundId } from '@/lib/preferences/notifications.ts';
import {
  AGENT_GROUPS,
  AGENT_ROLES,
  type AgentGroup,
  ALERT_ITEMS,
  COMPACTION_MODE_ITEMS,
  COST_LIMIT_TITLE,
  changeAgentModel,
  changeAgentSpeed,
  changeGroupModel,
  changeGroupSpeed,
  describeGroupSelects,
  describeRoleSelects,
  FIX_ROUND_ITEMS,
  FOLDERS_TITLE,
  listAgentModelItems,
  listAttentionItems,
  listBudgetItems,
  listCompactionItems,
  listGroupModelItems,
  listGroupSpeedItems,
  listSpeedItems,
  listUsageLimitItems,
  MERGE_ITEMS,
  needsCostLimit,
  PLAN_ITEMS,
  parseBudget,
  parseCompaction,
  parseFixRounds,
  parseUsageLimit,
  resolveAgentModelValue,
  resolveAttentionValue,
  resolveBudgetValue,
  resolveCompactionValue,
  resolveFixRoundValue,
  resolveGroupModel,
  resolveGroupSpeed,
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
import { navigate } from '@/router.ts';

const SECTIONS: { title: string; icon: Command['icon']; keywords: string[] }[] = [
  { title: 'Attention', icon: 'IconInboxEmpty', keywords: ['decisions', 'queue'] },
  { title: 'Notifications', icon: 'IconBell', keywords: ['sound', 'chime', 'alert', 'badge'] },
  {
    title: 'Agents',
    icon: 'IconRobot',
    keywords: [
      'models',
      'providers',
      'codex',
      'planner',
      'builder',
      'reviewer',
      'fixer',
      'answerer',
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
  { title: 'Engine', icon: 'IconToolbox', keywords: ['plans', 'fix rounds', 'merge'] },
  {
    title: 'Agent usage',
    icon: 'IconGauge',
    keywords: [
      'accounts',
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
    keywords: ['repositories', 'repos', 'folders', 'keys', 'colours'],
  },
  { title: 'Appearance', icon: 'IconSun', keywords: ['theme', 'layout', 'dark', 'light'] },
  { title: 'Setup', icon: 'IconArrowRotateClockwise', keywords: ['onboarding', 'setup chat'] },
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
    options: items
      .filter((item) => !item.disabled)
      .map((item) => ({ value: item.value, label: item.label, icon: item.icon })),
    pick,
    ...(searchOnly ? { searchOnly } : {}),
  };
}

function listGroupRoles(group: AgentGroup) {
  return group.roles.map(({ role }) => role);
}

function patchSettings(next: Partial<Settings>) {
  void updateSettings(next, SAVED);
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
        (next) => void changeGroupModel(settings, group, next, SAVED)
      ),
      settingChoice(
        `speed.${group.id}`,
        labels.speed,
        listGroupSpeedItems(settings, group, availability),
        resolveGroupSpeed(settings, group, availability),
        (next) => void changeGroupSpeed(settings, group, next, SAVED)
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
        (next) => void changeAgentModel(settings, role, next, SAVED),
        true
      ),
      settingChoice(
        `speed.${role}`,
        labels.speed,
        listSpeedItems(availability),
        resolveSpeedValue(settings, role, availability),
        (next) => void changeAgentSpeed(settings, role, next, SAVED),
        true
      ),
    ];
  });
}

function listUsageChoices(settings: Settings, snapshot: AccountsSnapshot | null): Command[] {
  const choices = [
    settingChoice(
      'usage-limit',
      USAGE_LIMIT_TITLE,
      listUsageLimitItems(settings),
      resolveUsageLimitValue(settings),
      (value) => patchSettings({ taskUsageLimit: parseUsageLimit(value) })
    ),
  ];
  if (needsCostLimit(settings, snapshot?.accounts ?? null)) {
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

export function listSettingsSections(
  settings: Settings,
  providers: AgentProviderInfo[],
  notifications: NotificationPreferences,
  snapshot: AccountsSnapshot | null = null
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
        ...listUsageChoices(settings, snapshot),
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
          keywords: ['onboarding', 'setup chat', 'folders', 'start over'],
          run: () => void restartOnboarding(),
        },
      ],
    },
  ];
}
