import { afterEach, beforeEach, describe, expect, it, setSystemTime } from 'bun:test';
import { resolveEngineCommands, type ShinsaState, USER_COMMAND_TYPES } from '@shinsa/core';
import { listGlobalSections } from '@/lib/command/global.ts';
import type { Command, CommandSection } from '@/lib/command/registry.ts';
import { isFeedbackOpen, registerFeedbackOpener } from '@/lib/feedback.ts';
import { resolveEndOfDay } from '@/lib/format/time.ts';
import { rememberTerminalPath } from '@/lib/terminal/tabs.ts';
import { spyOnCommands } from '../../support/commands.ts';
import { createProject, createShinsaState, NOW } from '../../support/state.ts';

const ALL_COMMANDS: ReadonlySet<string> = new Set(USER_COMMAND_TYPES);

let spies: ReturnType<typeof spyOnCommands>;

beforeEach(() => {
  spies = spyOnCommands();
  setSystemTime(NOW);
});

afterEach(() => {
  spies.restore();
  setSystemTime();
  document.documentElement.className = '';
});

const PROJECTS = [
  createProject({ id: 'web', name: 'Web', color: 'blue' }),
  createProject({ id: 'api', name: 'API', color: 'green' }),
];

function focused(projectId: string | null): ShinsaState {
  return createShinsaState({
    projects: PROJECTS,
    patch: { focus: { projectId, teamId: null, until: null } },
  });
}

function find(sections: CommandSection[], id: string): Command {
  const command = sections.flatMap((section) => section.commands).find((candidate) => candidate.id === id);
  if (!command) throw new Error(`No command ${id}`);
  return command;
}

function pick(command: Command, value: string) {
  if (command.kind !== 'choice') throw new Error(`${command.id} is not a choice`);
  command.pick(value);
}

describe('listGlobalSections', () => {
  it('groups Go to, Focus and Appearance in that order', () => {
    const sections = listGlobalSections(focused(null), { name: 'home' }, 'system', 'cards', ALL_COMMANDS, []);
    expect(sections.map((section) => [section.heading, section.rank])).toEqual([
      ['Go to', 50],
      ['Focus', 51],
      ['Appearance', 52],
    ]);
  });

  it('marks the page you are on', () => {
    rememberTerminalPath('/terminal');
    const sections = listGlobalSections(
      focused(null),
      { name: 'settings' },
      'system',
      'cards',
      ALL_COMMANDS,
      []
    );
    expect(sections[0]?.commands.map((command) => [command.label, command.current])).toEqual([
      ['Home', false],
      ['All tasks', false],
      ['Terminal', false],
      ['Settings', true],
      ['Send feedback on Shinsa', undefined],
    ]);
    expect(sections[0]?.commands.map((command) => (command.kind === 'go' ? command.to : null))).toEqual([
      '/',
      '/tasks',
      '/terminal',
      '/settings',
      null,
    ]);
  });

  it('opens the feedback popover on the button that is shown', () => {
    registerFeedbackOpener('header', () => true);
    const command = find(
      listGlobalSections(focused(null), { name: 'home' }, 'system', 'cards', ALL_COMMANDS, []),
      'feedback.open'
    );
    if (command.kind !== 'run') throw new Error('Expected a run command');
    command.run();
    expect(isFeedbackOpen()).toBe(true);
  });

  it('leaves feedback out on an engine that does not take it', () => {
    const sections = listGlobalSections(
      focused(null),
      { name: 'home' },
      'system',
      'cards',
      resolveEngineCommands(null),
      []
    );
    expect(sections[0]?.commands.map((command) => command.id)).not.toContain('feedback.open');
  });
});

describe('the focus choice', () => {
  it('lists your work and every project by name with its dot, on your work by default', () => {
    const focus = find(
      listGlobalSections(focused(null), { name: 'home' }, 'system', 'cards', ALL_COMMANDS, []),
      'focus.switch'
    );
    if (focus.kind !== 'choice') throw new Error('Expected a choice');
    expect(focus.hint).toBe('Your work');
    expect(focus.value).toBe('all');
    expect(focus.options.map((option) => [option.value, option.label, option.dot])).toEqual([
      ['all', 'Your work', 'gray'],
      ['api', 'API', 'green'],
      ['web', 'Web', 'blue'],
    ]);
  });

  it('switches focus with a toast naming the project', () => {
    const focus = find(
      listGlobalSections(focused(null), { name: 'home' }, 'system', 'cards', ALL_COMMANDS, []),
      'focus.switch'
    );
    pick(focus, 'web');
    pick(focus, 'all');
    pick(focus, 'removed');
    expect(spies.sent.mock.calls).toEqual([
      [{ type: 'focus.change', projectId: 'web', teamId: null, until: null }, 'Focused on Web.'],
      [{ type: 'focus.change', projectId: null, teamId: null, until: null }, 'Focused on your work.'],
      [{ type: 'focus.change', projectId: 'removed', teamId: null, until: null }, 'Focused on the project.'],
    ] as never);
  });

  it('shows the current project and offers timed focus only while typing', () => {
    const sections = listGlobalSections(
      focused('web'),
      { name: 'home' },
      'system',
      'cards',
      ALL_COMMANDS,
      []
    );
    const focus = find(sections, 'focus.switch');
    expect(focus).toMatchObject({ hint: 'Web', value: 'web' });
    expect(find(sections, 'focus.hours')).toMatchObject({
      label: 'Keep Web in focus for 2 hours',
      searchOnly: true,
    });
    expect(find(sections, 'focus.tonight')).toMatchObject({
      label: 'Keep Web in focus until tonight',
      searchOnly: true,
    });
  });

  it('keeps the project in focus for two hours or until tonight', () => {
    const sections = listGlobalSections(
      focused('web'),
      { name: 'home' },
      'system',
      'cards',
      ALL_COMMANDS,
      []
    );
    for (const id of ['focus.hours', 'focus.tonight']) {
      const command = find(sections, id);
      if (command.kind === 'run') command.run();
    }
    expect(spies.sent.mock.calls).toEqual([
      [
        { type: 'focus.change', projectId: 'web', teamId: null, until: NOW + 2 * 60 * 60 * 1000 },
        'In focus for 2 hours.',
      ],
      [
        { type: 'focus.change', projectId: 'web', teamId: null, until: resolveEndOfDay(NOW) },
        'In focus until tonight.',
      ],
    ] as never);
  });

  it('offers no timed focus while on your work, or when the focus has expired', () => {
    const expired = createShinsaState({
      projects: PROJECTS,
      patch: { focus: { projectId: 'web', teamId: null, until: NOW - 1 } },
    });
    for (const state of [focused(null), expired]) {
      const ids = listGlobalSections(state, { name: 'home' }, 'system', 'cards', ALL_COMMANDS, []).flatMap(
        (section) => section.commands.map((command) => command.id)
      );
      expect(ids).not.toContain('focus.hours');
    }
  });
});

const TEAMS = [{ id: 'team-1', name: 'Platform' }];

function focusedOnTeam(teamId: string, until: number | null = null): ShinsaState {
  return createShinsaState({ projects: PROJECTS, patch: { focus: { projectId: null, teamId, until } } });
}

describe('the focus choice with teams', () => {
  it('lists your teams after the projects and shows a focused team as the current choice', () => {
    const focus = find(
      listGlobalSections(focusedOnTeam('team-1'), { name: 'home' }, 'system', 'cards', ALL_COMMANDS, TEAMS),
      'focus.switch'
    );
    if (focus.kind !== 'choice') throw new Error('Expected a choice');
    expect(focus).toMatchObject({ hint: 'Platform', value: 'team:team-1' });
    expect(focus.options.map((option) => [option.value, option.label])).toEqual([
      ['all', 'Your work'],
      ['api', 'API'],
      ['web', 'Web'],
      ['team:team-1', 'Platform'],
    ]);
    expect(focus.options[3]?.icon).toBe('IconUserDuo');
  });

  it('switches to a team, naming it, or to a team it no longer knows', () => {
    const focus = find(
      listGlobalSections(focused(null), { name: 'home' }, 'system', 'cards', ALL_COMMANDS, TEAMS),
      'focus.switch'
    );
    pick(focus, 'team:team-1');
    pick(focus, 'team:gone');
    pick(focus, 'web');
    expect(spies.sent.mock.calls).toEqual([
      [{ type: 'focus.change', projectId: null, teamId: 'team-1', until: null }, 'Focused on Platform.'],
      [{ type: 'focus.change', projectId: null, teamId: 'gone', until: null }, 'Focused on the team.'],
      [{ type: 'focus.change', projectId: 'web', teamId: null, until: null }, 'Focused on Web.'],
    ] as never);
  });

  it('keeps a focused team in focus for two hours or until tonight', () => {
    const sections = listGlobalSections(
      focusedOnTeam('team-1'),
      { name: 'home' },
      'system',
      'cards',
      ALL_COMMANDS,
      TEAMS
    );
    expect(find(sections, 'focus.hours')).toMatchObject({ label: 'Keep Platform in focus for 2 hours' });
    for (const id of ['focus.hours', 'focus.tonight']) {
      const command = find(sections, id);
      if (command.kind === 'run') command.run();
    }
    expect(spies.sent.mock.calls).toEqual([
      [
        { type: 'focus.change', projectId: null, teamId: 'team-1', until: NOW + 2 * 60 * 60 * 1000 },
        'In focus for 2 hours.',
      ],
      [
        { type: 'focus.change', projectId: null, teamId: 'team-1', until: resolveEndOfDay(NOW) },
        'In focus until tonight.',
      ],
    ] as never);
  });
});

describe('appearance', () => {
  it('shows the current layout and switches it', () => {
    const cards = find(
      listGlobalSections(focused(null), { name: 'home' }, 'system', 'cards', ALL_COMMANDS, []),
      'appearance.layout'
    );
    expect(cards).toMatchObject({ hint: 'Desk', icon: 'IconLayoutGrid1', value: 'cards' });
    if (cards.kind !== 'choice') throw new Error('Not a choice');
    expect(cards.options.map((option) => [option.value, option.label])).toEqual([
      ['cards', 'Desk'],
      ['sidebar', 'Shelf'],
    ]);
    const sidebar = find(
      listGlobalSections(focused(null), { name: 'home' }, 'system', 'sidebar', ALL_COMMANDS, []),
      'appearance.layout'
    );
    expect(sidebar).toMatchObject({ hint: 'Shelf', icon: 'IconSidebar', value: 'sidebar' });
    pick(cards, 'sidebar');
    expect(localStorage.getItem('shinsa.layout')).toBe('sidebar');
    pick(cards, 'cards');
    expect(localStorage.getItem('shinsa.layout')).toBe('cards');
  });

  it('shows the current theme and changes it', () => {
    const dark = find(
      listGlobalSections(focused(null), { name: 'home' }, 'dark', 'cards', ALL_COMMANDS, []),
      'appearance.theme'
    );
    expect(dark).toMatchObject({ hint: 'Dark', icon: 'IconMoon', value: 'dark' });
    const light = find(
      listGlobalSections(focused(null), { name: 'home' }, 'light', 'cards', ALL_COMMANDS, []),
      'appearance.theme'
    );
    expect(light).toMatchObject({ hint: 'Light', icon: 'IconSun' });
    pick(light, 'dark');
    expect(localStorage.getItem('shinsa.theme')).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
