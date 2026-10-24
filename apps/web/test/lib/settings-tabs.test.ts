import { describe, expect, it } from 'bun:test';
import {
  findSettingsTab,
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
      'Agent usage',
      'Projects',
      'Integrations',
      'Automations',
    ]);
    expect(listSettingsTabs().map((tab) => tab.activeIcon)).toEqual([
      'IconSettingsGear1Filled',
      'IconAgentsFilled',
      'IconGaugeFilled',
      'IconFolder1Filled',
      'IconIntegrationsFilled',
      'IconCalendarClockFilled',
    ]);
  });

  it('finds a tab by id', () => {
    expect(findSettingsTab('accounts').sections).toEqual(['Accounts', 'Limits']);
    expect(findSettingsTab('agents').sections).toEqual(['Models', 'Engine', 'Versions']);
    expect(findSettingsTab('projects').sections).toEqual(['Repository folders', 'Projects']);
  });

  it('opens Integrations for a link to the context optimizer', () => {
    expect(resolveSettingsTab(null, '#context-optimizer')).toBe('integrations');
    expect(resolveSectionTab('Context optimizer')).toBe('integrations');
  });

  it('opens the tab the URL names, else the tab of the linked section, else General', () => {
    expect(resolveSettingsTab('agents')).toBe('agents');
    expect(resolveSettingsTab(null, '#limits')).toBe('accounts');
    expect(resolveSettingsTab(null, '#accounts')).toBe('accounts');
    expect(resolveSettingsTab(null, '#models')).toBe('agents');
    expect(resolveSettingsTab('nonsense', '#repository-folders')).toBe('projects');
    expect(resolveSettingsTab('integrations')).toBe('integrations');
    expect(resolveSettingsTab(null, '#mcps')).toBe('integrations');
    expect(resolveSettingsTab(null, '#nothing-here')).toBe('general');
    expect(resolveSettingsTab(null)).toBe('general');
    expect(resolveSettingsTab('nonsense', '#context')).toBe('general');
  });

  it('knows which tab holds a section, and orders sections the way the tabs show them', () => {
    expect(resolveSectionTab('Schedules')).toBe('automations');
    expect(resolveSectionTab('Context')).toBe('general');
    expect(resolveSectionTab('Notifications')).toBe('general');
    expect(resolveSectionTab('Somewhere else')).toBe('general');
    expect(resolveSectionRank('Appearance')).toBe(0);
    expect(resolveSectionRank('Setup')).toBeGreaterThan(resolveSectionRank('Notifications'));
    expect(resolveSectionRank('Somewhere else')).toBe(Number.POSITIVE_INFINITY);
  });

  it('keeps General out of the URL and links straight to a section', () => {
    expect(resolveSettingsTabParam('general')).toBeNull();
    expect(resolveSettingsTabParam('agents')).toBe('agents');
    expect(resolveSettingsPath('general')).toBe('/settings');
    expect(resolveSettingsPath('accounts', 'Limits')).toBe('/settings?tab=accounts#limits');
    expect(resolveSettingsPath('projects', 'Repository folders')).toBe(
      '/settings?tab=projects#repository-folders'
    );
  });
});
