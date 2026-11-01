import type { ShinsaState } from '@shinsa/core';
import type { MenuItemIcon } from '@shinsa/ui/components/menu-icon';
import { type Command, type CommandSection, RANK } from '@/lib/command/registry.ts';
import { sendCommandWithToast } from '@/lib/connection/commands.ts';
import { type FocusTeam, resolveFocusUntil, selectFocus, selectFocusTeam, YOUR_WORK } from '@/lib/focus.ts';
import {
  LAYOUT_NAMES,
  LAYOUT_ORDER,
  type LayoutPreference,
  writeLayoutPreference,
} from '@/lib/preferences/layout.ts';
import { THEME_ITEMS, type ThemePreference, writeThemePreference } from '@/lib/preferences/theme.ts';
import { listProjects } from '@/lib/projects.ts';
import { resolveTerminalEntry } from '@/lib/terminal/tabs.ts';
import type { Route } from '@/router.ts';

const FOCUS_ICON = 'IconCircleDotted';

const TEAM_FOCUS_ICON: MenuItemIcon = 'IconUserDuo';

const LAYOUT_KEYWORDS: Record<LayoutPreference, string[]> = {
  cards: ['cards', 'centred', 'top bar'],
  sidebar: ['sidebar', 'rail', 'queue'],
};

const YOUR_WORK_VALUE = 'all';

const TEAM_VALUE_PREFIX = 'team:';

interface FocusTarget {
  projectId: string | null;
  teamId: string | null;
}

function changeFocus(target: FocusTarget, until: number | null, done: string) {
  void sendCommandWithToast({ type: 'focus.change', ...target, until }, done);
}

function parseFocusValue(value: string): FocusTarget {
  if (value === YOUR_WORK_VALUE) return { projectId: null, teamId: null };
  if (value.startsWith(TEAM_VALUE_PREFIX))
    return { projectId: null, teamId: value.slice(TEAM_VALUE_PREFIX.length) };
  return { projectId: value, teamId: null };
}

function describeFocusDone(state: ShinsaState, teams: readonly FocusTeam[], target: FocusTarget) {
  if (target.teamId) {
    const team = teams.find((entry) => entry.id === target.teamId);
    return `Focused on ${team?.name ?? 'the team'}.`;
  }
  if (target.projectId) return `Focused on ${state.projects[target.projectId]?.name ?? 'the project'}.`;
  return 'Focused on your work.';
}

function createFocusSwitch(state: ShinsaState, teams: readonly FocusTeam[]): Command {
  const focus = selectFocus(state);
  const team = selectFocusTeam(state, teams);
  return {
    kind: 'choice',
    id: 'focus.switch',
    label: 'Switch focus',
    hint: team?.name ?? focus?.name ?? YOUR_WORK,
    icon: FOCUS_ICON,
    keywords: ['focus', 'project', 'team', 'filter', 'scope'],
    heading: 'Focus on',
    value: team ? `${TEAM_VALUE_PREFIX}${team.id}` : (focus?.id ?? YOUR_WORK_VALUE),
    options: [
      {
        value: YOUR_WORK_VALUE,
        label: YOUR_WORK,
        keywords: ['focus', 'everything', 'your work'],
        dot: 'gray',
      },
      ...listProjects(state).map((project) => ({
        value: project.id,
        label: project.name,
        keywords: ['focus', 'project', project.key],
        dot: project.color,
      })),
      ...teams.map((entry) => ({
        value: `${TEAM_VALUE_PREFIX}${entry.id}`,
        label: entry.name,
        keywords: ['focus', 'team', 'teammates'],
        icon: TEAM_FOCUS_ICON,
      })),
    ],
    pick: (value) => {
      const target = parseFocusValue(value);
      changeFocus(target, null, describeFocusDone(state, teams, target));
    },
  };
}

function listFocusCommands(state: ShinsaState, teams: readonly FocusTeam[]): Command[] {
  const team = selectFocusTeam(state, teams);
  const focus = selectFocus(state);
  const kept = team ?? focus;
  if (!kept) return [createFocusSwitch(state, teams)];
  const target: FocusTarget = { projectId: team ? null : (focus?.id ?? null), teamId: team?.id ?? null };
  return [
    createFocusSwitch(state, teams),
    {
      kind: 'run',
      id: 'focus.hours',
      label: `Keep ${kept.name} in focus for 2 hours`,
      icon: 'IconClock',
      searchOnly: true,
      keywords: ['focus', 'timer'],
      run: () => changeFocus(target, resolveFocusUntil('hours'), 'In focus for 2 hours.'),
    },
    {
      kind: 'run',
      id: 'focus.tonight',
      label: `Keep ${kept.name} in focus until tonight`,
      icon: 'IconMoon',
      searchOnly: true,
      keywords: ['focus', 'today', 'evening'],
      run: () => changeFocus(target, resolveFocusUntil('tonight'), 'In focus until tonight.'),
    },
  ];
}

function listGoCommands(route: Route): Command[] {
  return [
    {
      kind: 'go',
      id: 'go.home',
      label: 'Home',
      icon: 'IconHomeRoundDoor',
      current: route.name === 'home',
      keywords: ['queue', 'now', 'briefing', 'start'],
      to: '/',
    },
    {
      kind: 'go',
      id: 'go.tasks',
      label: 'All tasks',
      icon: 'IconListBullets',
      current: route.name === 'tasks',
      keywords: ['list', 'tasks', 'history', 'done', 'search'],
      to: '/tasks',
    },
    {
      kind: 'go',
      id: 'go.terminal',
      label: 'Terminal',
      icon: 'IconConsole',
      current: route.name === 'terminal',
      keywords: ['shell', 'console', 'command line', 'dev server'],
      to: resolveTerminalEntry(),
    },
    {
      kind: 'go',
      id: 'go.settings',
      label: 'Settings',
      icon: 'IconSettingsGear4',
      current: route.name === 'settings',
      keywords: ['preferences', 'config', 'options', 'projects', 'models'],
      to: '/settings',
    },
  ];
}

function listAppearanceCommands(theme: ThemePreference, layout: LayoutPreference): Command[] {
  return [
    {
      kind: 'choice',
      id: 'appearance.layout',
      label: 'Switch layout',
      hint: LAYOUT_NAMES[layout].label,
      icon: LAYOUT_NAMES[layout].icon,
      keywords: ['layout', 'view', 'mode', 'rail', 'cards', 'sidebar'],
      heading: 'Layout',
      value: layout,
      options: LAYOUT_ORDER.map((value) => ({
        value,
        label: LAYOUT_NAMES[value].label,
        icon: LAYOUT_NAMES[value].icon,
        keywords: LAYOUT_KEYWORDS[value],
      })),
      pick: (value) => writeLayoutPreference(value === 'cards' ? 'cards' : 'sidebar'),
    },
    {
      kind: 'choice',
      id: 'appearance.theme',
      label: 'Change theme',
      hint: THEME_ITEMS.find((item) => item.value === theme)?.label,
      icon: theme === 'dark' ? 'IconMoon' : 'IconSun',
      keywords: ['theme', 'dark mode', 'light mode', 'appearance', 'colour'],
      heading: 'Theme',
      value: theme,
      options: THEME_ITEMS,
      pick: (value) => writeThemePreference(value as ThemePreference),
    },
  ];
}

export function listGlobalSections(
  state: ShinsaState,
  route: Route,
  theme: ThemePreference,
  layout: LayoutPreference,
  teams: readonly FocusTeam[]
): CommandSection[] {
  return [
    { id: 'global.go', heading: 'Go to', rank: RANK.global, commands: listGoCommands(route) },
    {
      id: 'global.focus',
      heading: 'Focus',
      rank: RANK.global + 1,
      commands: listFocusCommands(state, teams),
    },
    {
      id: 'global.appearance',
      heading: 'Appearance',
      rank: RANK.global + 2,
      commands: listAppearanceCommands(theme, layout),
    },
  ];
}
