import { isTaskSettled } from '../domain/stages.ts';
import type { Task } from '../domain/types.ts';
import type { ShinsaState } from '../state/project.ts';
import { listProjectRepos, resolveTaskProject } from '../state/queries.ts';

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
  status: TerminalStatus;
  exitCode: number | null;
  startedAt: number;
  endedAt: number | null;
}

export interface TerminalTheme {
  foreground: string | null;
  background: string | null;
  cursor: string | null;
  cursorText: string | null;
  selectionBackground: string | null;
  selectionForeground: string | null;
  palette: (string | null)[];
}

export type TerminalCursorStyle = 'block' | 'bar' | 'underline';

export interface TerminalAppearance {
  source: 'ghostty' | 'shinsa';
  fontFamily: string | null;
  fontSize: number | null;
  cursorStyle: TerminalCursorStyle | null;
  cursorBlink: boolean | null;
  optionAsMeta: boolean;
  light: TerminalTheme | null;
  dark: TerminalTheme | null;
}

export interface TerminalsSnapshot {
  terminals: TerminalInfo[];
  appearance: TerminalAppearance;
  home: string;
}

export interface TerminalColors {
  foreground: string;
  background: string;
  cursor: string;
}

export type TerminalClientFrame =
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'colors'; colors: TerminalColors };

export type TerminalServerFrame = { type: 'reset'; cols: number; rows: number } | { type: 'live' };

export const TERMINAL_LIMITS = {
  terminals: 32,
  name: 60,
  cols: 1000,
  rows: 500,
  command: 4000,
} as const;

export const SHINSA_APPEARANCE: TerminalAppearance = {
  source: 'shinsa',
  fontFamily: null,
  fontSize: null,
  cursorStyle: null,
  cursorBlink: null,
  optionAsMeta: false,
  light: null,
  dark: null,
};

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

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
    if (!task.worktreePath || isTaskSettled(task) || resolveTaskProject(state, task) !== projectId) continue;
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

function isDimension(value: unknown, limit: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= limit;
}

function isColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR.test(value);
}

function parseColors(value: unknown): TerminalColors | null {
  if (!value || typeof value !== 'object') return null;
  const { foreground, background, cursor } = value as Record<string, unknown>;
  if (!(isColor(foreground) && isColor(background) && isColor(cursor))) return null;
  return { foreground, background, cursor };
}

export function parseTerminalClientFrame(text: string): TerminalClientFrame | null {
  let frame: unknown;
  try {
    frame = JSON.parse(text);
  } catch {
    return null;
  }
  if (!frame || typeof frame !== 'object') return null;
  const fields = frame as Record<string, unknown>;
  if (
    fields.type === 'resize' &&
    isDimension(fields.cols, TERMINAL_LIMITS.cols) &&
    isDimension(fields.rows, TERMINAL_LIMITS.rows)
  )
    return { type: 'resize', cols: fields.cols, rows: fields.rows };
  const colors = fields.type === 'colors' ? parseColors(fields.colors) : null;
  return colors ? { type: 'colors', colors } : null;
}

export function parseTerminalServerFrame(text: string): TerminalServerFrame | null {
  try {
    const frame = JSON.parse(text) as Record<string, unknown> | null;
    if (frame?.type === 'live') return { type: 'live' };
    if (frame?.type !== 'reset') return null;
    if (!(isDimension(frame.cols, TERMINAL_LIMITS.cols) && isDimension(frame.rows, TERMINAL_LIMITS.rows)))
      return null;
    return { type: 'reset', cols: frame.cols, rows: frame.rows };
  } catch {
    return null;
  }
}
