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
      'Cloud',
      'Usage',
      'Statistics',
      'Projects',
      'Browser',
      'Integrations',
      'Automations',
    ]);
  });

  it('lists Machines, Teams and Sharing in place of Remote access, Teams, Sharing and Slack on the hosted page', () => {
    expect(listConnectionSections(true)).toEqual(['Machines', 'Teams', 'Sharing']);
    expect(listConnectionSections(false)).toEqual(['Remote access', 'Teams', 'Sharing', 'Slack']);
  });

  it('gives each tab its own sections', () => {
    expect(findSettingsTab('general').sections).toEqual([
      'Appearance',
      'Notifications',
      'Updates',
      'Versions',
    ]);
    expect(findSettingsTab('agents').sections).toEqual(['Models', 'Engine', 'Context', 'Memory']);
    expect(findSettingsTab('autopilot').sections).toEqual(['Autopilot', 'Your hours']);
    expect(findSettingsTab('cloud').sections).toEqual(['Remote access', 'Teams', 'Sharing', 'Slack']);
    expect(findSettingsTab('usage').sections).toEqual(['Accounts', 'Auto pace', 'Forecast', 'Limits']);
    expect(findSettingsTab('statistics').sections).toEqual(['Shipping', 'Token usage']);
    expect(findSettingsTab('projects').sections).toEqual(['Repository folders', 'Worktrees', 'Projects']);
    expect(findSettingsTab('browser').sections).toEqual(['Browser']);
    expect(findSettingsTab('automations').sections).toEqual(['Schedules', 'Watchdogs']);
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

  it('opens the tab that now holds a section moved to another tab', () => {
    expect(resolveSettingsTab(null, '#updates')).toBe('general');
    expect(resolveSettingsTab(null, '#versions')).toBe('general');
    expect(resolveSettingsTab('about', '#updates')).toBe('general');
    expect(resolveSettingsTab(null, '#remote-access')).toBe('cloud');
    expect(resolveSettingsTab(null, '#teams')).toBe('cloud');
    expect(resolveSettingsTab(null, '#sharing')).toBe('cloud');
    expect(resolveSettingsTab('connections', '#slack')).toBe('cloud');
    expect(resolveSettingsTab('nonsense', '#context')).toBe('agents');
    expect(resolveSettingsTab(null, '#autopilot')).toBe('autopilot');
    expect(resolveSettingsTab(null, '#your-hours')).toBe('autopilot');
    expect(resolveSettingsTab(null, '#watchdogs')).toBe('automations');
    expect(resolveSettingsTab(null, '#browser')).toBe('browser');
    expect(resolveSettingsTab(null, '#auto-pace')).toBe('usage');
    expect(resolveSettingsTab(null, '#forecast')).toBe('usage');
  });

  it('knows which tab holds a section, and orders sections the way the tabs show them', () => {
    expect(resolveSectionTab('Schedules')).toBe('automations');
    expect(resolveSectionTab('Context')).toBe('agents');
    expect(resolveSectionTab('Notifications')).toBe('general');
    expect(resolveSectionTab('Somewhere else')).toBe('general');
    expect(resolveSectionRank('Appearance')).toBe(0);
    expect(resolveSectionRank('Watchdogs')).toBeGreaterThan(resolveSectionRank('Schedules'));
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
