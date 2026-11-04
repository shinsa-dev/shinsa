import { META } from '../browser/schema.ts';
import {
  HOME,
  HOME_DONE,
  PROJECT_PICKER,
  type Step,
  TAB_READY,
  TASK_ROW,
  TERMINAL_DONE,
  TERMINAL_SHOWN,
} from './schema.ts';

export function listNavigationSteps(tabs: readonly string[]): Step[] {
  const loop = [...tabs, tabs[0] ?? 'Overview'];
  const tabSteps = loop.slice(1).map((to, index) => {
    const from = loop[index] ?? 'Overview';
    return {
      label: `${from} → ${to}`,
      target: `__shell.tab('${to}')`,
      done: `__shell.selectedTab('${to}') && (${TAB_READY[to] ?? 'true'})`,
    };
  });
  return [
    {
      label: 'Home → task',
      pushes: 'State push on a task',
      target: TASK_ROW,
      done: `location.pathname.startsWith('/tasks/') && __shell.selectedTab('Overview')`,
    },
    ...tabSteps,
    { label: 'Task → Home', target: HOME, done: HOME_DONE },
    {
      label: 'Home → All tasks',
      pushes: 'State push on All tasks',
      target: `__shell.byText('header button', 'Tasks') || __shell.byText('nav [data-highlight-item]', 'All tasks')`,
      done: `location.pathname === '/tasks'`,
    },
    { label: 'All tasks → Home', target: HOME, done: HOME_DONE },
    {
      label: 'Home → Settings',
      target: `document.querySelector('header button[aria-label="Settings"]') || __shell.byText('nav [data-highlight-item]', 'Settings')`,
      done: `location.pathname === '/settings'`,
    },
    { label: 'Settings → Home', pushes: 'State push on Home', target: HOME, done: HOME_DONE },
    {
      label: '⌘K opens',
      key: { key: 'k', code: 'KeyK', keyCode: 75, modifiers: META },
      done: `!!document.querySelector('[cmdk-input]')`,
    },
  ];
}

export function listTerminalSteps(firstProject: string, secondProject: string): Step[] {
  const terminalTab = (index: number) =>
    `[...document.querySelectorAll('[aria-label="Terminals"] [role=tab]')].filter((tab) => tab.offsetParent)[${index}]`;
  const tabStep = (from: number, to: number): Step => ({
    label: `Terminal tab ${from + 1} → ${to + 1}`,
    target: terminalTab(to),
    done: `${terminalTab(to)}?.getAttribute('aria-selected') === 'true' && ${TERMINAL_SHOWN}`,
  });
  const projectStep = (from: string, to: string): Step => ({
    label: `Terminal ${from} → ${to}`,
    open: { target: PROJECT_PICKER, done: `!!__shell.byText('[role=menuitemradio]', '${to}')` },
    target: `__shell.byText('[role=menuitemradio]', '${to}')`,
    done: `${PROJECT_PICKER}?.textContent === '${to}' && ${TERMINAL_SHOWN}`,
  });
  return [
    {
      label: 'Home → Terminal',
      open: {
        target: `document.querySelector('header [data-services-trigger]')`,
        done: `!!document.querySelector('[data-terminal-entry]')`,
      },
      target: `document.querySelector('[data-terminal-entry]') || document.querySelector('header button[aria-label="Terminal"]')`,
      done: TERMINAL_DONE,
    },
    projectStep(firstProject, secondProject),
    tabStep(0, 1),
    tabStep(1, 2),
    tabStep(2, 0),
    projectStep(secondProject, firstProject),
    { label: 'Terminal → Home', target: HOME, done: HOME_DONE },
  ];
}
