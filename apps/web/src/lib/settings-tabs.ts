import { ACCOUNT_LABEL } from '@/lib/accounts/account.ts';
import { AUTO_PACE_LABEL } from '@/lib/accounts/auto-pace.ts';
import { FORECAST_TITLE } from '@/lib/accounts/forecast.ts';
import { ACTIVE_HOURS_LABEL } from '@/lib/active-hours.ts';
import { AUTOPILOT_TITLE } from '@/lib/autopilot.ts';
import { BROWSER_SECTION } from '@/lib/browser.ts';
import { REMOTE_ACCESS_SECTION } from '@/lib/remote-access.ts';
import { isRemoteBuild, MACHINES_SECTION } from '@/lib/remote/mode.ts';
import {
  FOLDERS_TITLE,
  MODELS_TITLE,
  resolveHashSectionId,
  resolveSectionId,
  WATCHDOG_SETTINGS_TITLE,
  WORKTREES_TITLE,
} from '@/lib/settings.ts';
import { SHARING_SECTION } from '@/lib/share/dialog.ts';
import { SLACK_SECTION } from '@/lib/slack.ts';
import { SHIPPING_SECTION } from '@/lib/stats/shipping.ts';
import { USAGE_SECTION } from '@/lib/stats/usage.ts';
import { TEAMS_SECTION } from '@/lib/teams/settings.ts';
import { UPDATES_SECTION } from '@/lib/updates.ts';
import { VERSIONS_SECTION } from '@/lib/versions.ts';

export type SettingsTabId =
  | 'general'
  | 'agents'
  | 'autopilot'
  | 'cloud'
  | 'usage'
  | 'statistics'
  | 'projects'
  | 'browser'
  | 'integrations'
  | 'automations';

interface SettingsTab {
  id: SettingsTabId;
  label: string;
  sections: string[];
}

export function listConnectionSections(remote: boolean) {
  return remote
    ? [MACHINES_SECTION, TEAMS_SECTION, SHARING_SECTION]
    : [REMOTE_ACCESS_SECTION, TEAMS_SECTION, SHARING_SECTION, SLACK_SECTION];
}

const SETTINGS_TABS: Record<SettingsTabId, SettingsTab> = {
  general: {
    id: 'general',
    label: 'General',
    sections: ['Appearance', 'Notifications', UPDATES_SECTION, VERSIONS_SECTION],
  },
  agents: {
    id: 'agents',
    label: 'Agents',
    sections: [MODELS_TITLE, 'Engine', 'Context', 'Memory'],
  },
  autopilot: {
    id: 'autopilot',
    label: AUTOPILOT_TITLE,
    sections: [AUTOPILOT_TITLE, ACTIVE_HOURS_LABEL.title],
  },
  cloud: {
    id: 'cloud',
    label: 'Cloud',
    sections: listConnectionSections(isRemoteBuild()),
  },
  usage: {
    id: 'usage',
    label: 'Usage',
    sections: [ACCOUNT_LABEL.section, AUTO_PACE_LABEL.title, FORECAST_TITLE, 'Limits'],
  },
  statistics: {
    id: 'statistics',
    label: 'Statistics',
    sections: [SHIPPING_SECTION, USAGE_SECTION],
  },
  projects: {
    id: 'projects',
    label: 'Projects',
    sections: [FOLDERS_TITLE, WORKTREES_TITLE, 'Projects'],
  },
  browser: {
    id: 'browser',
    label: BROWSER_SECTION,
    sections: [BROWSER_SECTION],
  },
  integrations: {
    id: 'integrations',
    label: 'Integrations',
    sections: ['Context optimizer', 'MCPs', 'Plugins', 'Skills'],
  },
  automations: {
    id: 'automations',
    label: 'Automations',
    sections: ['Schedules', WATCHDOG_SETTINGS_TITLE],
  },
};

const DEFAULT_TAB: SettingsTabId = 'general';

export function listSettingsTabs() {
  return Object.values(SETTINGS_TABS);
}

export function findSettingsTab(id: SettingsTabId) {
  return SETTINGS_TABS[id];
}

function selectSectionTab(sectionId: string) {
  return (
    listSettingsTabs().find((tab) => tab.sections.some((title) => resolveSectionId(title) === sectionId)) ??
    null
  );
}

export function resolveSectionTab(title: string): SettingsTabId {
  return selectSectionTab(resolveSectionId(title))?.id ?? DEFAULT_TAB;
}

export function resolveSettingsTab(param: string | null, hash = ''): SettingsTabId {
  const named = listSettingsTabs().find((tab) => tab.id === param);
  if (named) return named.id;
  const sectionId = resolveHashSectionId(hash);
  return (sectionId && selectSectionTab(sectionId)?.id) || DEFAULT_TAB;
}

export function resolveSettingsTabParam(tab: SettingsTabId) {
  return tab === DEFAULT_TAB ? null : tab;
}

export function resolveSettingsPath(tab: SettingsTabId, title: string | null = null) {
  const param = resolveSettingsTabParam(tab);
  const query = param ? `?tab=${param}` : '';
  const hash = title ? `#${resolveSectionId(title).replace(/^settings-/, '')}` : '';
  return `/settings${query}${hash}`;
}

export function resolveSectionRank(title: string) {
  const rank = listSettingsTabs()
    .flatMap((tab) => tab.sections)
    .findIndex((entry) => resolveSectionId(entry) === resolveSectionId(title));
  return rank === -1 ? Number.POSITIVE_INFINITY : rank;
}
