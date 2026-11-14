import type { ShinsaState } from '@shinsa/core';
import type { MenuItemIcon } from '@shinsa/ui/components/menu-icon';
import { type Command, type CommandSection, RANK } from '@/lib/command/registry.ts';
import { sendCommandWithToast } from '@/lib/connection/commands.ts';
import { FEEDBACK_ICON, openFeedback } from '@/lib/feedback.ts';
import {
  resolveFocusLabel,
  type FocusTarget,
  type FocusTeam,
  resolveFocusTarget,
  resolveFocusUntil,
  selectFocusInitiative,
  selectFocusProjects,
  selectFocusTeam,
  YOUR_WORK,
} from '@/lib/focus.ts';
import { listOpenInitiatives } from '@/lib/initiatives/membership.ts';
import { INITIATIVE_ICON } from '@/lib/initiatives/view.ts';
import { THEME_ITEMS, type ThemePreference, writeThemePreference } from '@/lib/preferences/theme.ts';
import { listProjects } from '@/lib/projects.ts';
import { resolveTerminalEntry } from '@/lib/terminal/tabs.ts';
import type { Route } from '@/router.ts';

const FOCUS_ICON = 'IconCircleDotted';

const TEAM_FOCUS_ICON: MenuItemIcon = 'IconUserDuo';

const YOUR_WORK_VALUE = 'all';

const TEAM_VALUE_PREFIX = 'team:';

const INITIATIVE_VALUE_PREFIX = 'initiative:';

function changeFocus(target: FocusTarget, until: number | null, done: string) {
  void sendCommandWithToast({ type: 'focus.change', ...target, until }, done);
}

function parseFocusValue(value: string): FocusTarget {
  if (value === YOUR_WORK_VALUE) return { projectId: null, teamId: null };
  if (value.startsWith(INITIATIVE_VALUE_PREFIX))
    return { projectId: null, teamId: null, initiativeId: value.slice(INITIATIVE_VALUE_PREFIX.length) };
  if (value.startsWith(TEAM_VALUE_PREFIX))
    return { projectId: null, teamId: value.slice(TEAM_VALUE_PREFIX.length) };
  return { projectId: value, teamId: null };
}

function describeFocusDone(state: ShinsaState, teams: readonly FocusTeam[], target: FocusTarget) {
  if (target.initiativeId) {
    return `Focused on ${state.initiatives[target.initiativeId]?.name ?? 'the initiative'}.`;
  }
  if (target.teamId) {
    const team = teams.find((entry) => entry.id === target.teamId);
    return `Focused on ${team?.name ?? 'the team'}.`;
  }
  if (target.projectId) return `Focused on ${state.projects[target.projectId]?.name ?? 'the project'}.`;
  return 'Focused on your work.';
}

function resolveFocusValue(target: FocusTarget) {
  if (target.initiativeId) return `${INITIATIVE_VALUE_PREFIX}${target.initiativeId}`;
  if (target.teamId) return `${TEAM_VALUE_PREFIX}${target.teamId}`;
  if (target.projectIds) return '';
  return target.projectId ?? YOUR_WORK_VALUE;
}

function resolveKeptFocus(state: ShinsaState, teams: readonly FocusTeam[]) {
  const initiative = selectFocusInitiative(state);
  const team = selectFocusTeam(state, teams);
  const selection = selectFocusProjects(state);
  if (initiative) {
    const target: FocusTarget = { projectId: null, teamId: null, initiativeId: initiative.id };
    return { label: initiative.name, target };
  }
  return {
    label: team?.name ?? resolveFocusLabel(state, selection),
    target: resolveFocusTarget(selection, team?.id ?? null),
  };
}

function createFocusSwitch(state: ShinsaState, teams: readonly FocusTeam[]): Command {
  const kept = resolveKeptFocus(state, teams);
  return {
    kind: 'choice',
    id: 'focus.switch',
    label: 'Switch focus',
    hint: kept.label ?? YOUR_WORK,
    icon: FOCUS_ICON,
    keywords: ['focus', 'project', 'team', 'initiative', 'filter', 'scope'],
    heading: 'Focus on',
    value: resolveFocusValue(kept.target),
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
      ...listOpenInitiatives(state).map((initiative) => ({
        value: `${INITIATIVE_VALUE_PREFIX}${initiative.id}`,
        label: initiative.name,
        keywords: ['focus', 'initiative'],
        icon: INITIATIVE_ICON,
      })),
    ],
    pick: (value) => {
      const target = parseFocusValue(value);
      changeFocus(target, null, describeFocusDone(state, teams, target));
    },
  };
}

function listFocusCommands(state: ShinsaState, teams: readonly FocusTeam[]): Command[] {
  const { label: kept, target } = resolveKeptFocus(state, teams);
  if (!kept) return [createFocusSwitch(state, teams)];
  return [
    createFocusSwitch(state, teams),
    {
      kind: 'run',
      id: 'focus.hours',
      label: `Keep ${kept} in focus for 2 hours`,
      icon: 'IconClock',
      searchOnly: true,
      keywords: ['focus', 'timer'],
      run: () => changeFocus(target, resolveFocusUntil('hours'), 'In focus for 2 hours.'),
    },
    {
      kind: 'run',
      id: 'focus.tonight',
      label: `Keep ${kept} in focus until tonight`,
      icon: 'IconMoon',
      searchOnly: true,
      keywords: ['focus', 'today', 'evening'],
      run: () => changeFocus(target, resolveFocusUntil('tonight'), 'In focus until tonight.'),
    },
  ];
}

function listGoCommands(route: Route, commands: ReadonlySet<string>): Command[] {
  const go: Command[] = [
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
    {
      kind: 'run',
      id: 'feedback.open',
      label: 'Send feedback on Shinsa',
      icon: FEEDBACK_ICON,
      keywords: ['feedback', 'issue', 'bug', 'report', 'github', 'idea'],
      run: openFeedback,
    },
  ];
  return commands.has('feedback.write') ? go : go.filter((command) => command.id !== 'feedback.open');
}

function listAppearanceCommands(theme: ThemePreference): Command[] {
  return [
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
  commands: ReadonlySet<string>,
  teams: readonly FocusTeam[]
): CommandSection[] {
  return [
    { id: 'global.go', heading: 'Go to', rank: RANK.global, commands: listGoCommands(route, commands) },
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
      commands: listAppearanceCommands(theme),
    },
  ];
}
