import { Option } from 'effect';
import type { Focus, FocusProjects } from './types.ts';

export interface SingleProjectFocus {
  projectId: string | null;
}

export const NO_FOCUS: Focus = { projectIds: [], except: false, teamId: null, until: null };

export const NO_FOCUS_PROJECTS: FocusProjects = { projectIds: [], except: false };

export function resolveFocusSelection(focus: FocusProjects | SingleProjectFocus): FocusProjects {
  if ('projectIds' in focus) return { projectIds: focus.projectIds, except: focus.except };
  return { projectIds: focus.projectId ? [focus.projectId] : [], except: false };
}

export function normaliseFocusProjects(projectIds: readonly string[], except: boolean): FocusProjects {
  const unique = [...new Set(projectIds)].sort();
  return { projectIds: unique, except: unique.length > 0 && except };
}

export function isProjectInFocus(focus: FocusProjects | SingleProjectFocus, projectId: string | null) {
  const { projectIds, except } = resolveFocusSelection(focus);
  if (projectIds.length === 0) return true;
  const listed = projectId !== null && projectIds.includes(projectId);
  return except ? !listed : listed;
}

export function selectSingleFocusProject(focus: FocusProjects | SingleProjectFocus): Option.Option<string> {
  const { projectIds, except } = resolveFocusSelection(focus);
  return !except && projectIds.length === 1 ? Option.fromNullishOr(projectIds[0]) : Option.none();
}

export function serializeNames(names: readonly string[]) {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

export function describeFocusProjects(
  focus: FocusProjects | SingleProjectFocus,
  nameOf: (projectId: string) => string | undefined
) {
  const { projectIds, except } = resolveFocusSelection(focus);
  const names = projectIds.flatMap((projectId) => nameOf(projectId) ?? []).sort((a, b) => a.localeCompare(b));
  if (names.length === 0) return Option.none<string>();
  return Option.some(except ? `everything but ${serializeNames(names)}` : serializeNames(names));
}
