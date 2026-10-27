import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { type AgentProviderInfo, createSettings, KNOWN_CODEX_MODELS, type Settings } from '@shinsa/core';
import { waitFor } from '@testing-library/react';
import type { Command, CommandSection } from '@/lib/command/registry.ts';
import { listSettingsSections, openSettingsSection } from '@/lib/command/settings.ts';
import * as onboarding from '@/lib/connection/onboarding.ts';
import { DEFAULT_PREFERENCES, readNotificationPreferences } from '@/lib/preferences/notifications.ts';
import { createAccount, createSnapshot } from '../../support/accounts.ts';
import { spyOnCommands } from '../../support/commands.ts';
import { installDesktop } from '../../support/desktop.ts';
import { installNotifications } from '../../support/notifications.ts';
import { createRepo } from '../../support/state.ts';

let spies: ReturnType<typeof spyOnCommands>;

beforeEach(() => {
  spies = spyOnCommands();
});

afterEach(() => {
  spies.restore();
});

const MODELS: AgentProviderInfo[] = [
  {
    id: 'claude',
    label: 'Claude',
    models: [
      { id: 'opus', label: 'Opus', description: '' },
      { id: 'sonnet', label: 'Sonnet', description: '' },
    ],
  },
  { id: 'codex', label: 'Codex', models: KNOWN_CODEX_MODELS },
];

function find(sections: CommandSection[], id: string): Command {
  const command = sections.flatMap((section) => section.commands).find((candidate) => candidate.id === id);
  if (!command) throw new Error(`No command ${id}`);
  return command;
}

function pick(sections: CommandSection[], id: string, value: string) {
  const command = find(sections, id);
  if (command.kind !== 'choice') throw new Error(`${id} is not a choice`);
  command.pick(value);
}

describe('Jump to', () => {
  it('lists every settings section', () => {
    const [jump] = listSettingsSections(createSettings(), MODELS, DEFAULT_PREFERENCES);
    expect(jump?.heading).toBe('Jump to');
    expect(jump?.commands.map((command) => [command.label, command.hint])).toEqual([
      ['Appearance', 'General'],
      ['Attention', 'General'],
      ['Notifications', 'General'],
      ['Context', 'General'],
      ['Setup', 'General'],
      ['Models', 'Agents'],
      ['Engine', 'Agents'],
      ['Versions', 'Agents'],
      ['Accounts', 'Agent usage'],
      ['Limits', 'Agent usage'],
      ['Repository folders', 'Projects'],
      ['Projects', 'Projects'],
      ['MCPs', 'Integrations'],
      ['Plugins', 'Integrations'],
      ['Skills', 'Integrations'],
      ['Schedules', 'Automations'],
    ]);
  });

  it('scrolls to a section on the open tab, and opens the tab that holds any other', () => {
    history.replaceState(null, '', '/settings?tab=agents');
    const section = document.createElement('section');
    section.id = 'settings-engine';
    const scroll = mock((_options?: ScrollIntoViewOptions) => {});
    section.scrollIntoView = scroll;
    document.body.append(section);
    const sections = listSettingsSections(createSettings(), MODELS, DEFAULT_PREFERENCES);
    const run = (id: string) => {
      const command = find(sections, id);
      if (command.kind === 'run') command.run();
    };
    run('settings.section.engine');
    expect(scroll.mock.calls).toEqual([[{ block: 'start', behavior: 'smooth' }]]);
    run('settings.section.projects');
    expect(`${location.pathname}${location.search}${location.hash}`).toBe('/settings?tab=projects#projects');
    section.remove();
  });
});

describe('Change a setting', () => {
  it('offers every setting as a choice on its current value', () => {
    const sections = listSettingsSections(createSettings(), MODELS, DEFAULT_PREFERENCES);
    expect(sections[1]?.commands.map((command) => [command.label, command.hint])).toEqual([
      ['Decisions up now', 'One at a time'],
      ['Play a sound', 'When Shinsa is in the background'],
      ['Sound', 'Chime'],
      ['Show a notification', 'Never'],
      ['Approve plans', 'When you ask'],
      ['Automatic fix rounds', 'Until clean'],
      ['Delegations at once', 'No limit'],
      ['Merge with', 'Squash'],
      ['Compaction', 'Eunoe compaction'],
      ['Model for task agents', 'Opus'],
      ['Speed for task agents', 'Standard'],
      ['Model for quick jobs', 'Sonnet'],
      ['Speed for quick jobs', 'Standard'],
      ['Agent model', 'Opus'],
      ['Agent speed', 'Standard'],
      ['Reviewer model', 'Opus'],
      ['Reviewer speed', 'Standard'],
      ['Answerer model', 'Opus'],
      ['Answerer speed', 'Standard'],
      ['Classifier model', 'Sonnet'],
      ['Classifier speed', 'Standard'],
      ['Writer model', 'Sonnet'],
      ['Writer speed', 'Standard'],
      ['Usage limit per task', 'No limit'],
      ['Switch accounts at', '90%'],
      ['After a usage limit', 'Resume automatically'],
      ['File list', 'Left'],
    ]);
  });

  it('switches the app’s update channel, and only in the app', () => {
    expect(() =>
      find(listSettingsSections(createSettings(), MODELS, DEFAULT_PREFERENCES), 'settings.update-channel')
    ).toThrow();
    const fake = installDesktop();
    const sections = listSettingsSections(
      createSettings(),
      MODELS,
      DEFAULT_PREFERENCES,
      null,
      undefined,
      'left',
      'stable'
    );
    expect(find(sections, 'settings.update-channel')).toMatchObject({
      label: 'Update channel',
      hint: 'Stable',
    });
    pick(sections, 'settings.update-channel', 'beta');
    pick(sections, 'settings.update-channel', 'stable');
    expect(fake.channels).toEqual(['beta', 'stable']);
    fake.restore();
  });

  it('moves the Code tab’s file list to either side', () => {
    const sections = listSettingsSections(
      createSettings(),
      MODELS,
      DEFAULT_PREFERENCES,
      null,
      undefined,
      'right'
    );
    expect(sections[1]?.commands.at(-1)?.hint).toBe('Right');
    pick(sections, 'settings.explorer-side', 'left');
    expect(localStorage.getItem('shinsa.code-explorer-side')).toBe('left');
    pick(sections, 'settings.explorer-side', 'right');
    expect(localStorage.getItem('shinsa.code-explorer-side')).toBe('right');
    localStorage.removeItem('shinsa.code-explorer-side');
  });

  it('holds fast speed back with its reason where fast mode needs usage credits nobody has', () => {
    const settings = { ...createSettings(), fastMode: true };
    const noCredits = createSnapshot({
      accounts: [
        createAccount({ id: 'a', usage: { ...createAccount({ id: 'a' }).usage, fastMode: 'needs_credits' } }),
      ],
    });
    const held = listSettingsSections(settings, MODELS, DEFAULT_PREFERENCES, noCredits);
    expect(find(held, 'settings.speed.task')).toMatchObject({
      hint: 'Standard',
      value: 'off',
      options: [
        { value: 'off', label: 'Standard', icon: 'IconSpeedMiddle' },
        { value: 'on', label: 'Fast', icon: 'IconSpeedHigh', disabled: 'Unavailable: needs usage credits' },
      ],
    });
    expect(find(held, 'settings.speed.agent')).toMatchObject({
      value: 'off',
      options: [{ value: 'off' }, { value: 'on', disabled: 'Unavailable: needs usage credits' }],
    });
    const open = listSettingsSections(settings, MODELS, DEFAULT_PREFERENCES, createSnapshot());
    expect(find(open, 'settings.speed.task')).toMatchObject({ value: 'on', hint: 'Fast' });
  });

  it('keeps the per-role choices for typing, and the cost limit for setups without a weekly limit', () => {
    const sections = listSettingsSections(createSettings(), MODELS, DEFAULT_PREFERENCES, createSnapshot());
    expect(find(sections, 'settings.model.agent')).toMatchObject({ searchOnly: true });
    expect(find(sections, 'settings.budget')).toMatchObject({
      label: 'Cost limit per task',
      hint: 'No limit',
    });
    const group = find(sections, 'settings.model.task');
    expect(group).not.toHaveProperty('searchOnly');
  });

  it('asks when to ask you about a limit only while a limit waits for you', () => {
    const waiting: Settings = { ...createSettings(), autoResume: false };
    expect(find(listSettingsSections(waiting, MODELS, DEFAULT_PREFERENCES), 'settings.snooze')).toMatchObject(
      {
        label: 'Ask me what to do',
        hint: 'When the limit resets',
      }
    );
  });

  it('shows a stored attention limit the usual choices do not offer', () => {
    const settings: Settings = { ...createSettings(), attentionLimit: 4 };
    const attention = find(listSettingsSections(settings, MODELS, DEFAULT_PREFERENCES), 'settings.attention');
    expect(attention).toMatchObject({ value: '4', hint: '4 at a time', icon: 'IconInboxEmpty' });
  });

  it('saves each change as a settings patch', () => {
    const settings: Settings = {
      ...createSettings(),
      agentModels: { agent: 'sonnet' },
      autoResume: false,
      compaction: 'claude',
    };
    const sections = listSettingsSections({ ...settings, taskBudgetUsd: 2 }, MODELS, DEFAULT_PREFERENCES);
    pick(sections, 'settings.attention', '3');
    pick(sections, 'settings.plans', 'large');
    pick(sections, 'settings.plans', 'never');
    pick(sections, 'settings.fix-rounds', '5');
    pick(sections, 'settings.fix-rounds', 'endless');
    pick(sections, 'settings.delegation-limit', '8');
    pick(sections, 'settings.delegation-limit', 'off');
    pick(sections, 'settings.budget', '5');
    pick(sections, 'settings.budget', 'off');
    pick(sections, 'settings.merge', 'rebase');
    pick(sections, 'settings.model.reviewer', 'claude:sonnet');
    pick(sections, 'settings.model.quick', 'codex:gpt-6-astra');
    pick(sections, 'settings.model.task', 'mixed');
    pick(sections, 'settings.usage-limit', '10');
    pick(sections, 'settings.usage-limit', 'off');
    pick(sections, 'settings.switch-at', '95');
    pick(sections, 'settings.resume', 'wait');
    pick(sections, 'settings.snooze', 'off');
    pick(sections, 'settings.compaction', 'off');
    pick(sections, 'settings.compaction', '5');
    pick(sections, 'settings.compaction.mode', 'eunoe_default');
    pick(sections, 'settings.speed.task', 'on');
    pick(sections, 'settings.speed.agent', 'off');
    expect(spies.sent.mock.calls.map(([command, done]) => [command, done])).toEqual([
      [{ type: 'settings.change', patch: { attentionLimit: 3 } }, 'Saved.'],
      [{ type: 'settings.change', patch: { approvePlans: true } }, 'Saved.'],
      [{ type: 'settings.change', patch: { approvePlans: false } }, 'Saved.'],
      [{ type: 'settings.change', patch: { maxFixRounds: 5 } }, 'Saved.'],
      [{ type: 'settings.change', patch: { maxFixRounds: null } }, 'Saved.'],
      [{ type: 'settings.change', patch: { delegationLimit: 8 } }, 'Saved.'],
      [{ type: 'settings.change', patch: { delegationLimit: null } }, 'Saved.'],
      [{ type: 'settings.change', patch: { taskBudgetUsd: 5 } }, 'Saved.'],
      [{ type: 'settings.change', patch: { taskBudgetUsd: null } }, 'Saved.'],
      [{ type: 'settings.change', patch: { mergeMethod: 'rebase' } }, 'Saved.'],
      [
        {
          type: 'settings.change',
          patch: {
            agentProviders: { reviewer: 'claude' },
            agentModels: { agent: 'sonnet', reviewer: 'sonnet' },
          },
        },
        'Saved.',
      ],
      [
        {
          type: 'settings.change',
          patch: {
            agentProviders: { classifier: 'codex', writer: 'codex' },
            agentModels: { agent: 'sonnet', classifier: 'gpt-6-astra', writer: 'gpt-6-astra' },
          },
        },
        'Saved.',
      ],
      [{ type: 'settings.change', patch: { taskUsageLimit: 10 } }, 'Saved.'],
      [{ type: 'settings.change', patch: { taskUsageLimit: null } }, 'Saved.'],
      [{ type: 'settings.change', patch: { accountSwitchAt: 95 } }, 'Saved.'],
      [{ type: 'settings.change', patch: { autoResume: false } }, 'Saved.'],
      [{ type: 'settings.change', patch: { snoozeLimited: false } }, 'Saved.'],
      [{ type: 'settings.change', patch: { idleCompaction: false } }, 'Saved.'],
      [{ type: 'settings.change', patch: { idleCompaction: true, compactionLeadMinutes: 5 } }, 'Saved.'],
      [{ type: 'settings.change', patch: { compaction: 'eunoe_default' } }, 'Saved.'],
      [
        {
          type: 'settings.change',
          patch: { agentFastModes: { agent: true, reviewer: true, answerer: true } },
        },
        'Saved.',
      ],
      [{ type: 'settings.change', patch: { agentFastModes: { agent: false } } }, 'Saved.'],
    ] as never);
  });

  it('offers every provider’s models in one choice, and a role on Codex reads its Codex model', () => {
    const settings: Settings = { ...createSettings(), agentProviders: { agent: 'codex' } };
    const sections = listSettingsSections(settings, MODELS, DEFAULT_PREFERENCES);
    const model = find(sections, 'settings.model.agent');
    if (model.kind !== 'choice') throw new Error('Not a choice');
    expect(model).toMatchObject({ value: 'codex:gpt-6-astra', icon: 'IconOpenaiCodex' });
    expect(model.options.map((option) => option.label)).toEqual([
      'Opus',
      'Sonnet',
      ...KNOWN_CODEX_MODELS.map((entry) => entry.label),
    ]);
  });

  it('offers the switch threshold without the custom entry ⌘K cannot take', () => {
    const settings: Settings = { ...createSettings(), accountSwitchAt: 85 };
    const command = find(listSettingsSections(settings, MODELS, DEFAULT_PREFERENCES), 'settings.switch-at');
    if (command.kind !== 'choice') throw new Error('Not a choice');
    expect(command.options.map((option) => option.label)).toEqual(['80%', '85%', '90%', '95%', '98%']);
    expect(command.value).toBe('85');
  });

  it('offers delegations at once without the custom entry ⌘K cannot take', () => {
    const settings: Settings = { ...createSettings(), delegationLimit: 6 };
    const command = find(
      listSettingsSections(settings, MODELS, DEFAULT_PREFERENCES),
      'settings.delegation-limit'
    );
    if (command.kind !== 'choice') throw new Error('Not a choice');
    expect(command.options.map((option) => option.label)).toEqual([
      'No limit',
      '2 at once',
      '4 at once',
      '6 at once',
      '8 at once',
      '16 at once',
    ]);
    expect(command.value).toBe('6');
  });

  it('keeps sound and notification choices in this browser, asking before notifications', async () => {
    const notifications = installNotifications('default', 'granted');
    const sections = listSettingsSections(createSettings(), MODELS, {
      sound: 'always',
      soundId: 'pop',
      notify: 'never',
    });
    expect(find(sections, 'settings.sound')).toMatchObject({ value: 'always', hint: 'Always' });
    expect(find(sections, 'settings.sound-id')).toMatchObject({ value: 'pop', hint: 'Pop' });
    pick(sections, 'settings.sound', 'never');
    pick(sections, 'settings.sound-id', 'ping');
    pick(sections, 'settings.notify', 'unfocused');
    await waitFor(() => expect(readNotificationPreferences().notify).toBe('unfocused'));
    expect(readNotificationPreferences()).toEqual({ sound: 'never', soundId: 'ping', notify: 'unfocused' });
    expect(notifications.requests).toHaveLength(1);
    expect(spies.sent).not.toHaveBeenCalled();
    notifications.restore();
  });
});

describe('openSettingsSection', () => {
  it('scrolls to the section on its tab and opens its tab from anywhere else', () => {
    history.replaceState(null, '', '/settings?tab=accounts');
    const section = document.createElement('section');
    section.id = 'settings-accounts';
    const scroll = mock((_options?: ScrollIntoViewOptions) => {});
    section.scrollIntoView = scroll;
    document.body.append(section);
    openSettingsSection('Accounts');
    expect(scroll).toHaveBeenCalledTimes(1);
    section.remove();
    history.replaceState(null, '', '/tasks');
    openSettingsSection('Accounts');
    expect(`${location.pathname}${location.search}${location.hash}`).toBe('/settings?tab=accounts#accounts');
    history.replaceState(null, '', '/tasks');
    openSettingsSection('Repository folders');
    expect(`${location.search}${location.hash}`).toBe('?tab=projects#repository-folders');
    history.replaceState(null, '', '/tasks');
    openSettingsSection('Attention');
    expect(`${location.pathname}${location.search}${location.hash}`).toBe('/settings#attention');
  });
});

describe('Setup', () => {
  it('runs setup again from ⌘K', () => {
    const restart = spyOn(onboarding, 'restartOnboarding').mockResolvedValue(undefined);
    const command = find(
      listSettingsSections(createSettings(), MODELS, DEFAULT_PREFERENCES),
      'settings.setup.restart'
    );
    expect(command).toMatchObject({ label: 'Run setup again', icon: 'IconArrowRotateClockwise' });
    if (command.kind === 'run') command.run();
    expect(restart).toHaveBeenCalledTimes(1);
    restart.mockRestore();
  });
});

describe('Where agents work', () => {
  it('each repository is a choice found by search, GitButler held back with its reason until it is set up, and picking one saves it', () => {
    const repos = [createRepo({ id: 'web' }), createRepo({ id: 'app', workspace: 'gitbutler' })];
    const support = {
      web: { butInstalled: false, gitButlerWorkspace: true },
      app: { butInstalled: true, gitButlerWorkspace: true },
    };
    const sections = listSettingsSections(createSettings(), MODELS, DEFAULT_PREFERENCES, null, {
      repos,
      support,
    });
    const web = find(sections, 'settings.workspace.web');
    expect(web).toMatchObject({
      kind: 'choice',
      label: 'Where agents work in web',
      hint: 'Worktrees',
      searchOnly: true,
      value: 'worktrees',
      keywords: expect.arrayContaining(['gitbutler', 'main checkout']),
    });
    if (web.kind !== 'choice') throw new Error('not a choice');
    expect(web.options.map((option) => [option.value, option.disabled])).toEqual([
      ['worktrees', undefined],
      ['gitbutler', 'Install GitButler’s command line (`but`) to use it.'],
      ['main_checkout', undefined],
    ]);
    const app = find(sections, 'settings.workspace.app');
    if (app.kind !== 'choice') throw new Error('not a choice');
    expect(app.options.map((option) => option.value)).toEqual(['worktrees', 'gitbutler', 'main_checkout']);
    expect(sections.flatMap((section) => section.commands).map((command) => command.id)).toContain(
      'settings.workspace.app'
    );
    pick(sections, 'settings.workspace.web', 'main_checkout');
    expect(spies.sent).toHaveBeenCalledWith(
      { type: 'repo.update', repoId: 'web', patch: { workspace: 'main_checkout' } },
      'New tasks in web work in its checkout, one at a time. Tasks already working keep where they are.'
    );
    expect(
      listSettingsSections(createSettings(), MODELS, DEFAULT_PREFERENCES).flatMap((section) =>
        section.commands.filter((command) => command.id.startsWith('settings.workspace.'))
      )
    ).toEqual([]);
  });
});
