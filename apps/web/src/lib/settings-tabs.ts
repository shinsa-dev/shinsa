import { ACCOUNT_LABEL } from '@/lib/accounts/account.ts';
import { isRemoteBuild, MACHINES_SECTION } from '@/lib/remote/mode.ts';
import { REMOTE_ACCESS_SECTION } from '@/lib/remote-access.ts';
import { FOLDERS_TITLE, MODELS_TITLE, resolveHashSectionId, resolveSectionId } from '@/lib/settings.ts';
import { SHIPPING_SECTION } from '@/lib/stats/shipping.ts';
import { USAGE_SECTION } from '@/lib/stats/usage.ts';
import { UPDATES_SECTION } from '@/lib/updates.ts';
import { VERSIONS_SECTION } from '@/lib/versions.ts';

export type SettingsTabId =
  | 'general'
  | 'statistics'
  | 'agents'
  | 'accounts'
  | 'projects'
  | 'integrations'
  | 'automations';

interface SettingsTab {
  id: SettingsTabId;
  label: string;
  sections: string[];
}

const SETTINGS_TABS: Record<SettingsTabId, SettingsTab> = {
  general: {
    id: 'general',
    label: 'General',
    sections: [
      'Appearance',
      'Attention',
      'Notifications',
      'Context',
      isRemoteBuild() ? MACHINES_SECTION : REMOTE_ACCESS_SECTION,
      'Setup',
      UPDATES_SECTION,
    ],
  },
  statistics: {
    id: 'statistics',
    label: 'Statistics',
    sections: [SHIPPING_SECTION, USAGE_SECTION],
  },
  agents: {
    id: 'agents',
    label: 'Agents',
    sections: [MODELS_TITLE, 'Engine', 'Memory', VERSIONS_SECTION],
  },
  accounts: {
    id: 'accounts',
    label: 'Agent Usage',
    sections: [ACCOUNT_LABEL.section, 'Limits'],
  },
  projects: {
    id: 'projects',
    label: 'Projects',
    sections: [FOLDERS_TITLE, 'Projects'],
  },
  integrations: {
    id: 'integrations',
    label: 'Integrations',
    sections: ['Context optimizer', 'MCPs', 'Plugins', 'Skills'],
  },
  automations: {
    id: 'automations',
    label: 'Automations',
    sections: ['Schedules'],
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
