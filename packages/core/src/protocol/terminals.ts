import { Option, Schema } from 'effect';
import { isTaskSettled } from '../domain/stages.ts';
import type { Task } from '../domain/types.ts';
import type { ShinsaState } from '../state/project.ts';
import { listProjectRepos, resolveTaskProject } from '../state/queries.ts';
import { TerminalClientFrame, TerminalServerFrame } from './schema.ts';
import type { ServiceDefinition } from './services.ts';

export type TerminalStatus = 'running' | 'exited' | 'stopped';

export type TerminalPlaceKind = 'repository' | 'folder' | 'worktree';

export interface TerminalPlace {
  path: string;
  label: string;
  kind: TerminalPlaceKind;
  taskId: string | null;
}

export interface TerminalInfo {
  id: string;
  projectId: string;
  name: string | null;
  title: string | null;
  cwd: string;
  place: TerminalPlaceKind;
  taskId: string | null;
  serviceId: string | null;
  port: number | null;
  remoteUrl?: string | null;
  status: TerminalStatus;
  exitCode: number | null;
  startedAt: number;
  endedAt: number | null;
}

export interface TerminalsSnapshot {
  terminals: TerminalInfo[];
  services: ServiceDefinition[];
  home: string;
}

export interface TerminalForeground {
  program: string | null;
}

const decodeTerminalClientFrame = Schema.decodeUnknownOption(Schema.fromJsonString(TerminalClientFrame));

const decodeTerminalServerFrame = Schema.decodeUnknownOption(Schema.fromJsonString(TerminalServerFrame));

function resolveBaseName(path: string) {
  return path.replace(/\/+$/, '').split('/').pop() || path;
}

function describeTaskPlace(task: Task) {
  return task.handle ? `${task.handle} ${task.title}` : task.title;
}

export function listTerminalPlaces(state: ShinsaState, projectId: string): TerminalPlace[] {
  const places: TerminalPlace[] = [];
  const add = (place: TerminalPlace) => {
    if (!places.some((each) => each.path === place.path)) places.push(place);
  };
  for (const repo of listProjectRepos(state, projectId).sort((a, b) => a.name.localeCompare(b.name)))
    add({ path: repo.path, label: repo.name, kind: 'repository', taskId: null });
  for (const folder of state.projects[projectId]?.folders ?? [])
    add({ path: folder, label: resolveBaseName(folder), kind: 'folder', taskId: null });
  for (const task of Object.values(state.tasks)) {
    if (
      !task.worktreePath ||
      isTaskSettled(task) ||
      Option.getOrNull(resolveTaskProject(state, task)) !== projectId
    )
      continue;
    add({ path: task.worktreePath, label: describeTaskPlace(task), kind: 'worktree', taskId: task.id });
  }
  return places;
}

export function resolveTaskTerminalPlace(state: ShinsaState, task: Task): TerminalPlace | null {
  if (task.worktreePath)
    return { path: task.worktreePath, label: describeTaskPlace(task), kind: 'worktree', taskId: task.id };
  const repo = task.repoId ? state.repos[task.repoId] : undefined;
  if (!repo) return null;
  return { path: repo.path, label: repo.name, kind: 'repository', taskId: null };
}

export function resolveTerminalLabel(terminal: Pick<TerminalInfo, 'name' | 'title' | 'cwd'>) {
  return terminal.name ?? terminal.title ?? resolveBaseName(terminal.cwd);
}

export function parseTerminalClientFrame(text: string): TerminalClientFrame | null {
  return Option.getOrNull(decodeTerminalClientFrame(text));
}

export function parseTerminalServerFrame(text: string): TerminalServerFrame | null {
  return Option.getOrNull(decodeTerminalServerFrame(text));
}
