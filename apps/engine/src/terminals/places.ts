import {
  DomainError,
  listTerminalPlaces,
  resolveTaskServiceCwd,
  type ServiceDefinition,
  type ServiceSuggestion,
  type ShinsaState,
  type TerminalPlace,
  type TerminalPlaceKind,
} from '@shinsa/core';
import { resolveSharedCacheEnv } from '../checks/caches/paths.ts';
import { isFolder, isInside } from '../files/paths.ts';
import { listServiceSuggestions } from './detect.ts';
import type { ServiceMachine, ServiceRun, TerminalStart } from './schema.ts';

export function resolveTerminalStart(
  places: TerminalPlace[],
  projectId: string,
  path: string,
  home: string
): TerminalStart {
  const place = places.find((each) => each.path === path);
  const homePlace: TerminalPlaceKind | null = places.length === 0 && path === home ? 'folder' : null;
  if (!(place || homePlace))
    throw new DomainError({ code: 'terminal_place_invalid', message: 'Pick one of the project’s folders.' });
  if (!isFolder(path))
    throw new DomainError({ code: 'terminal_place_missing', message: 'That folder is not there anymore.' });
  return { projectId, cwd: path, place: place?.kind ?? 'folder', taskId: place?.taskId ?? null };
}

export function resolveServicePlace(
  places: TerminalPlace[],
  cwd: string,
  home: string
): TerminalPlaceKind | null {
  const own = places.filter((each) => each.kind !== 'worktree');
  const found = own.find((each) => isInside(each.path, cwd));
  if (found) return found.kind;
  return own.length === 0 && isInside(home, cwd) ? 'folder' : null;
}

export function listNewServiceSuggestions(suggestions: ServiceSuggestion[], services: ServiceDefinition[]) {
  return suggestions.filter(
    (suggestion) =>
      !services.some(
        (service) =>
          service.name.toLowerCase() === suggestion.name.toLowerCase() ||
          (service.cwd === suggestion.cwd && service.command === suggestion.command)
      )
  );
}

export function listNewSuggestions(
  places: TerminalPlace[],
  services: ServiceDefinition[]
): ServiceSuggestion[] {
  const roots = places.filter((place) => place.kind !== 'worktree').map((place) => place.path);
  return listNewServiceSuggestions(listServiceSuggestions(roots), services);
}

export function resolveServicePlaceIn(state: ShinsaState, service: ServiceDefinition, home: string) {
  return resolveServicePlace(listTerminalPlaces(state, service.projectId), service.cwd, home);
}

export function resolveServiceRunIn(
  state: ShinsaState,
  service: ServiceDefinition,
  taskId: string | null,
  machine: ServiceMachine
): ServiceRun | null {
  if (taskId === null) {
    const place = resolveServicePlaceIn(state, service, machine.home);
    return place ? { cwd: service.cwd, place, taskId: null } : null;
  }
  const task = state.tasks[taskId];
  if (!(task?.worktreePath && task.repoId)) return null;
  const cwd = resolveTaskServiceCwd(state, service, task);
  if (cwd === null) return null;
  const env = resolveSharedCacheEnv(task.worktreePath, machine.dataDir, task.repoId);
  return { cwd, place: 'worktree', taskId, env };
}
