import { describe, expect, it } from 'bun:test';
import {
  findSettingsTab,
  listConnectionSections,
  listSettingsTabs,
  resolveSectionRank,
  resolveSectionTab,
  resolveSettingsPath,
  resolveSettingsTab,
  resolveSettingsTabParam,
} from '@/lib/settings-tabs.ts';

describe('settings tabs', () => {
  it('lists the tabs in order', () => {
    expect(listSettingsTabs().map((tab) => tab.label)).toEqual([
      'General',
      'Agents',
      'Autopilot',
      'Connections',
      'Usage',
      'Statistics',
      'Projects',
      'Integrations',
      'Automations',
      'About',
    ]);
  });

  it('lists Machines, Teams and Sharing in place of Remote access, Teams, Sharing and Slack on the hosted page', () => {
    expect(listConnectionSections(true)).toEqual(['Machines', 'Teams', 'Sharing']);
    expect(listConnectionSections(false)).toEqual(['Remote access', 'Teams', 'Sharing', 'Slack']);
  });

  it('gives each tab its own sections', () => {
    expect(findSettingsTab('general').sections).toEqual(['Appearance', 'Attention', 'Notifications']);
    expect(findSettingsTab('agents').sections).toEqual(['Models', 'Engine', 'Watchdogs', 'Memory']);
    expect(findSettingsTab('autopilot').sections).toEqual(['Autopilot', 'Your hours', 'Context']);
    expect(findSettingsTab('connections').sections).toEqual(['Remote access', 'Teams', 'Sharing', 'Slack']);
    expect(findSettingsTab('usage').sections).toEqual(['Accounts', 'Auto pace', 'Forecast', 'Limits']);
    expect(findSettingsTab('statistics').sections).toEqual(['Shipping', 'Token usage']);
    expect(findSettingsTab('projects').sections).toEqual([
      'Repository folders',
      'Worktrees',
      'Projects',
      'Browser',
    ]);
    expect(findSettingsTab('about').sections).toEqual(['Updates', 'Versions', 'Setup']);
  });

  it('opens Integrations for a link to the context optimizer', () => {
    expect(resolveSettingsTab(null, '#context-optimizer')).toBe('integrations');
    expect(resolveSectionTab('Context optimizer')).toBe('integrations');
  });

  it('opens the tab the URL names, else the tab of the linked section, else General', () => {
    expect(resolveSettingsTab('agents')).toBe('agents');
    expect(resolveSettingsTab('statistics')).toBe('statistics');
    expect(resolveSettingsTab(null, '#shipping')).toBe('statistics');
    expect(resolveSettingsTab(null, '#token-usage')).toBe('statistics');
    expect(resolveSettingsTab(null, '#limits')).toBe('usage');
    expect(resolveSettingsTab(null, '#accounts')).toBe('usage');
    expect(resolveSettingsTab(null, '#models')).toBe('agents');
    expect(resolveSettingsTab('nonsense', '#repository-folders')).toBe('projects');
    expect(resolveSettingsTab('integrations')).toBe('integrations');
    expect(resolveSettingsTab(null, '#mcps')).toBe('integrations');
    expect(resolveSettingsTab(null, '#nothing-here')).toBe('general');
    expect(resolveSettingsTab(null)).toBe('general');
    expect(resolveSettingsTab('accounts')).toBe('general');
  });

  it('opens the tab that now holds a section moved out of General or Agents', () => {
    expect(resolveSettingsTab(null, '#updates')).toBe('about');
    expect(resolveSettingsTab(null, '#setup')).toBe('about');
    expect(resolveSettingsTab(null, '#versions')).toBe('about');
    expect(resolveSettingsTab(null, '#remote-access')).toBe('connections');
    expect(resolveSettingsTab(null, '#teams')).toBe('connections');
    expect(resolveSettingsTab(null, '#sharing')).toBe('connections');
    expect(resolveSettingsTab(null, '#slack')).toBe('connections');
    expect(resolveSettingsTab('nonsense', '#context')).toBe('autopilot');
    expect(resolveSettingsTab(null, '#autopilot')).toBe('autopilot');
    expect(resolveSettingsTab(null, '#your-hours')).toBe('autopilot');
    expect(resolveSettingsTab(null, '#watchdogs')).toBe('agents');
    expect(resolveSettingsTab(null, '#auto-pace')).toBe('usage');
    expect(resolveSettingsTab(null, '#forecast')).toBe('usage');
  });

  it('knows which tab holds a section, and orders sections the way the tabs show them', () => {
    expect(resolveSectionTab('Schedules')).toBe('automations');
    expect(resolveSectionTab('Context')).toBe('autopilot');
    expect(resolveSectionTab('Notifications')).toBe('general');
    expect(resolveSectionTab('Somewhere else')).toBe('general');
    expect(resolveSectionRank('Appearance')).toBe(0);
    expect(resolveSectionRank('Setup')).toBeGreaterThan(resolveSectionRank('Schedules'));
    expect(resolveSectionRank('Somewhere else')).toBe(Number.POSITIVE_INFINITY);
  });

  it('keeps General out of the URL and links straight to a section', () => {
    expect(resolveSettingsTabParam('general')).toBeNull();
    expect(resolveSettingsTabParam('agents')).toBe('agents');
    expect(resolveSettingsPath('general')).toBe('/settings');
    expect(resolveSettingsPath('usage', 'Limits')).toBe('/settings?tab=usage#limits');
    expect(resolveSettingsPath('projects', 'Repository folders')).toBe(
      '/settings?tab=projects#repository-folders'
    );
  });
});
