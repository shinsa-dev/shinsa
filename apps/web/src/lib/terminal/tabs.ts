import {
  listTerminalPlaces,
  type Project,
  resolveFocusProject,
  resolveTerminalLabel,
  type ShinsaState,
  type Task,
  type TerminalInfo,
  type TerminalPlace,
  type TerminalPlaceKind,
  type TerminalsSnapshot,
} from '@shinsa/core';
import type { IconName } from '@shinsa/ui/components/icon';
import type { MenuItemIcon } from '@shinsa/ui/components/menu-icon';
import { listProjects, resolveProjectMark } from '@/lib/projects.ts';

const PLACE_HEADINGS: Record<TerminalPlaceKind, string> = {
  repository: 'Repositories',
  folder: 'Folders',
  worktree: 'Task worktrees',
};

const PLACE_ICONS: Record<TerminalPlaceKind, IconName> = {
  repository: 'IconFolder1',
  folder: 'IconFolders',
  worktree: 'IconBranch',
};

const PLACE_ORDER: TerminalPlaceKind[] = ['repository', 'folder', 'worktree'];

export interface PlaceGroup {
  kind: TerminalPlaceKind;
  heading: string;
  icon: MenuItemIcon;
  places: TerminalPlace[];
}

const TERMINAL_HOME = '/terminal';

let lastPath = TERMINAL_HOME;

export function rememberTerminalPath(path: string) {
  lastPath = path.startsWith(TERMINAL_HOME) ? path : TERMINAL_HOME;
}

export function resolveTerminalEntry() {
  return lastPath;
}

export function resolveTerminalPath(projectKey: string, terminalId?: string | null) {
  const params = new URLSearchParams({ project: projectKey });
  if (terminalId) params.set('terminal', terminalId);
  return `/terminal?${params.toString()}`;
}

export function resolveTerminalProject(
  state: ShinsaState,
  requested: string | null,
  now: number
): Project | null {
  const projects = listProjects(state);
  const wanted = requested?.toLowerCase();
  const named = wanted
    ? projects.find((project) => project.key.toLowerCase() === wanted || project.id === requested)
    : undefined;
  if (named) return named;
  const focus = resolveFocusProject(state, now);
  return (focus ? state.projects[focus] : undefined) ?? projects[0] ?? null;
}

export function listProjectTerminals(snapshot: TerminalsSnapshot | null, projectId: string | null) {
  if (!snapshot || !projectId) return [];
  return snapshot.terminals.filter((terminal) => terminal.projectId === projectId);
}

export type TerminalFilter = 'yours' | 'tasks' | 'services' | 'all';

type TerminalKind = Exclude<TerminalFilter, 'all'>;

export const TERMINAL_FILTERS: { value: TerminalFilter; label: string; icon: IconName }[] = [
  { value: 'yours', label: 'Your terminals', icon: 'IconUser' },
  { value: 'tasks', label: 'Task terminals', icon: 'IconBranch' },
  { value: 'services', label: 'Services', icon: 'IconServer' },
  { value: 'all', label: 'All terminals', icon: 'IconConsole' },
];

function resolveTerminalKind(terminal: TerminalInfo): TerminalKind {
  if (terminal.serviceId) return 'services';
  return terminal.taskId ? 'tasks' : 'yours';
}

function isShownBy(terminal: TerminalInfo, filter: TerminalFilter) {
  return filter === 'all' || resolveTerminalKind(terminal) === filter;
}

export function listShownTerminals(
  terminals: TerminalInfo[],
  filter: TerminalFilter,
  requested: string | null
) {
  return terminals.filter((terminal) => terminal.id === requested || isShownBy(terminal, filter));
}

export function countTerminalsByFilter(terminals: TerminalInfo[]): Record<TerminalFilter, number> {
  const counts: Record<TerminalFilter, number> = { yours: 0, tasks: 0, services: 0, all: terminals.length };
  for (const terminal of terminals) counts[resolveTerminalKind(terminal)] += 1;
  return counts;
}

export function resolveFilterLabel(filter: TerminalFilter) {
  return TERMINAL_FILTERS.find((entry) => entry.value === filter)?.label ?? filter;
}

export function describeFilterEmpty(filter: TerminalFilter, projectName: string) {
  switch (filter) {
    case 'yours':
      return {
        title: `No terminals of yours in ${projectName}`,
        description: 'Terminals you open here show up first. A terminal keeps running when you close Shinsa.',
      };
    case 'tasks':
      return {
        title: `No task terminals in ${projectName}`,
        description: 'Open a terminal from a task to work in its worktree.',
      };
    case 'services':
      return {
        title: `No services running in ${projectName}`,
        description: 'A service’s output shows here while it runs.',
      };
    case 'all':
      return {
        title: `No terminals in ${projectName}`,
        description: 'A terminal keeps running when you close Shinsa.',
      };
  }
}

export function showsServices(filter: TerminalFilter) {
  return filter === 'services' || filter === 'all';
}

export function resolveActiveTerminal(terminals: TerminalInfo[], requested: string | null) {
  return terminals.find((terminal) => terminal.id === requested) ?? terminals[0] ?? null;
}

export function resolveTerminalAfterClose(terminals: TerminalInfo[], closedId: string) {
  const index = terminals.findIndex((terminal) => terminal.id === closedId);
  if (index < 0) return null;
  return terminals[index + 1] ?? terminals[index - 1] ?? null;
}

export function moveTerminal(ids: string[], movedId: string, targetId: string) {
  const from = ids.indexOf(movedId);
  const to = ids.indexOf(targetId);
  if (from < 0 || to < 0 || from === to) return ids;
  const next = ids.filter((id) => id !== movedId);
  next.splice(to, 0, movedId);
  return next;
}

function resolvePlaceIcon(state: ShinsaState, projectId: string, kind: TerminalPlaceKind) {
  return resolveProjectMark(
    PLACE_ICONS[kind],
    kind === 'repository' ? state.projects[projectId]?.color : null
  );
}

export function groupTerminalPlaces(state: ShinsaState, projectId: string): PlaceGroup[] {
  const places = listTerminalPlaces(state, projectId);
  return PLACE_ORDER.flatMap((kind) => {
    const group = places.filter((place) => place.kind === kind);
    if (group.length === 0) return [];
    return [
      { kind, heading: PLACE_HEADINGS[kind], icon: resolvePlaceIcon(state, projectId, kind), places: group },
    ];
  });
}

export function resolveDefaultPlace(
  state: ShinsaState,
  projectId: string,
  home: string | null
): TerminalPlace | null {
  const place = listTerminalPlaces(state, projectId)[0];
  if (place) return place;
  return home ? { path: home, label: 'Home folder', kind: 'folder', taskId: null } : null;
}

function describeServiceEnd(terminal: TerminalInfo, name: string) {
  if (terminal.status === 'stopped') return `${name} is stopped. Its last output is above.`;
  if (terminal.exitCode === 0) return `${name} exited.`;
  if (terminal.exitCode === null) return `${name} ended without an exit code.`;
  return `${name} exited with code ${terminal.exitCode}.`;
}

export function describeTerminalEnd(terminal: TerminalInfo) {
  if (terminal.status === 'running') return null;
  if (terminal.serviceId) return describeServiceEnd(terminal, resolveTerminalLabel(terminal));
  if (terminal.status === 'stopped')
    return 'Shinsa’s engine restarted, so this shell ended. Its last output is above.';
  if (terminal.exitCode === 0 || terminal.exitCode === null) return 'The shell exited.';
  return `The shell exited with code ${terminal.exitCode}.`;
}

export function resolveTerminalTabLabel(terminal: TerminalInfo, tasks: Record<string, Pick<Task, 'handle'>>) {
  const label = resolveTerminalLabel(terminal);
  const handle = terminal.serviceId && terminal.taskId ? tasks[terminal.taskId]?.handle : null;
  return handle ? `${label} · ${handle}` : label;
}

export function describeTerminalTab(terminal: TerminalInfo) {
  if (terminal.status === 'running') return terminal.cwd;
  const end =
    terminal.status === 'stopped'
      ? 'Ended when the engine restarted'
      : terminal.exitCode
        ? `Exited with code ${terminal.exitCode}`
        : 'Exited';
  return `${end} · ${terminal.cwd}`;
}

export function describeFindResults(results: { index: number; count: number } | null, query: string) {
  if (!(query && results)) return '';
  if (results.count === 0) return 'No results';
  return results.index >= 0 ? `${results.index + 1} of ${results.count}` : `${results.count} found`;
}

export function describeTerminalClose(terminal: TerminalInfo, program: string) {
  return `${program} is still running in “${resolveTerminalLabel(terminal)}”. Closing the terminal stops it, and its scrollback is gone.`;
}

export function resolveNewTerminalPlace(
  active: TerminalInfo | null,
  groups: PlaceGroup[],
  fallback: TerminalPlace | null
): TerminalPlace | null {
  const places = groups.flatMap((group) => group.places);
  const same = active ? places.find((place) => place.path === active.cwd) : undefined;
  return same ?? fallback;
}
