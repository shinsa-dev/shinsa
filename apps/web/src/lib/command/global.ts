import type { ShinsaState } from '@shinsa/core';
import { type Command, type CommandSection, RANK } from '@/lib/command/registry.ts';
import { sendCommandWithToast } from '@/lib/connection/commands.ts';
import { resolveFocusUntil, selectFocus } from '@/lib/focus.ts';
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

const LAYOUT_KEYWORDS: Record<LayoutPreference, string[]> = {
  cards: ['cards', 'centred', 'top bar'],
  sidebar: ['sidebar', 'rail', 'queue'],
};

function changeFocus(projectId: string | null, until: number | null, done: string) {
  void sendCommandWithToast({ type: 'focus.change', projectId, until }, done);
}

function createFocusSwitch(state: ShinsaState): Command {
  const focus = selectFocus(state);
  return {
    kind: 'choice',
    id: 'focus.switch',
    label: 'Switch focus project',
    hint: focus ? focus.name : 'All work',
    icon: FOCUS_ICON,
    keywords: ['focus', 'project', 'filter', 'scope'],
    heading: 'Focus on',
    value: focus?.id ?? 'all',
    options: [
      { value: 'all', label: 'All work', keywords: ['focus', 'everything'] },
      ...listProjects(state).map((project) => ({
        value: project.id,
        label: project.name,
        keywords: ['focus', 'project', project.key],
        dot: project.color,
      })),
    ],
    pick: (value) => {
      if (value === 'all') {
        changeFocus(null, null, 'Focused on all work.');
        return;
      }
      changeFocus(value, null, `Focused on ${state.projects[value]?.name ?? 'the project'}.`);
    },
  };
}

function listFocusCommands(state: ShinsaState): Command[] {
  const focus = selectFocus(state);
  if (!focus) return [createFocusSwitch(state)];
  return [
    createFocusSwitch(state),
    {
      kind: 'run',
      id: 'focus.hours',
      label: `Keep ${focus.name} in focus for 2 hours`,
      icon: 'IconClock',
      searchOnly: true,
      keywords: ['focus', 'timer'],
      run: () => changeFocus(focus.id, resolveFocusUntil('hours'), 'In focus for 2 hours.'),
    },
    {
      kind: 'run',
      id: 'focus.tonight',
      label: `Keep ${focus.name} in focus until tonight`,
      icon: 'IconMoon',
      searchOnly: true,
      keywords: ['focus', 'today', 'evening'],
      run: () => changeFocus(focus.id, resolveFocusUntil('tonight'), 'In focus until tonight.'),
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
      icon: 'IconSettingsGear1',
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
  layout: LayoutPreference
): CommandSection[] {
  return [
    { id: 'global.go', heading: 'Go to', rank: RANK.global, commands: listGoCommands(route) },
    { id: 'global.focus', heading: 'Focus', rank: RANK.global + 1, commands: listFocusCommands(state) },
    {
      id: 'global.appearance',
      heading: 'Appearance',
      rank: RANK.global + 2,
      commands: listAppearanceCommands(theme, layout),
    },
  ];
}
