import {
  DomainError,
  listTerminalPlaces,
  type ServiceDefinition,
  type ServiceSuggestion,
  type ShinsaState,
  type TerminalPlace,
  type TerminalPlaceKind,
} from '@shinsa/core';
import { isInside } from '../files/paths.ts';
import type { TerminalStart } from './schema.ts';

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

export function listSuggestionRoots(places: TerminalPlace[]) {
  return places.filter((place) => place.kind !== 'worktree').map((place) => place.path);
}

export function resolveServicePlaceIn(state: ShinsaState, service: ServiceDefinition, home: string) {
  return resolveServicePlace(listTerminalPlaces(state, service.projectId), service.cwd, home);
}
