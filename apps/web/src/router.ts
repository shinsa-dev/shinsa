import { type ShinsaState, selectTaskByReference, type Task } from '@shinsa/core';
import { Option, Result } from 'effect';
import { createContext, useContext, useSyncExternalStore } from 'react';
import { createSignal } from '@/lib/signal.ts';

export type Route =
  | { name: 'home' }
  | { name: 'tasks' }
  | { name: 'task'; reference: string }
  | { name: 'automation'; scheduleId: string }
  | { name: 'team-task'; teamId: string; instanceId: string; taskId: string }
  | { name: 'settings' }
  | { name: 'terminal' }
  | { name: 'onboarding' }
  | { name: 'ui' };

export interface RouteView {
  route: Route;
  search: string;
}

const signal = createSignal();

function decodeSegment(segment: string) {
  return Result.getSuccess(Result.try(() => decodeURIComponent(segment)));
}

function parseSegment(pattern: RegExp, pathname: string) {
  const segment = pattern.exec(pathname)?.[1];
  return segment ? decodeSegment(segment) : Option.none();
}

function parseTeamTaskSegments(pathname: string) {
  const match = /^\/teams\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(pathname);
  if (!match) return Option.none();
  return Option.all({
    teamId: decodeSegment(match[1] ?? ''),
    instanceId: decodeSegment(match[2] ?? ''),
    taskId: decodeSegment(match[3] ?? ''),
  });
}

export function parseRoute(pathname: string): Route {
  const reference = parseSegment(/^\/tasks\/([^/]+)$/, pathname);
  if (Option.isSome(reference)) return { name: 'task', reference: reference.value };
  const scheduleId = parseSegment(/^\/automations\/([^/]+)$/, pathname);
  if (Option.isSome(scheduleId)) return { name: 'automation', scheduleId: scheduleId.value };
  const team = parseTeamTaskSegments(pathname);
  if (Option.isSome(team)) return { name: 'team-task', ...team.value };
  if (pathname === '/tasks') return { name: 'tasks' };
  if (pathname === '/settings') return { name: 'settings' };
  if (pathname === '/terminal') return { name: 'terminal' };
  if (pathname === '/onboarding') return { name: 'onboarding' };
  if (pathname === '/ui') return { name: 'ui' };
  return { name: 'home' };
}

export function resolveRouteBase(env: Record<string, unknown>) {
  const base = typeof env.BASE_URL === 'string' ? env.BASE_URL : '/';
  return base.replace(/\/+$/, '');
}

const ROUTE_BASE = resolveRouteBase(import.meta.env);

export function stripRouteBase(pathname: string, base = ROUTE_BASE) {
  if (!base) return pathname;
  if (pathname === base) return '/';
  return pathname.startsWith(`${base}/`) ? pathname.slice(base.length) : pathname;
}

export function withRouteBase(path: string, base = ROUTE_BASE) {
  if (!(base && path.startsWith('/'))) return path;
  if (path === base || path.startsWith(`${base}/`) || path.startsWith(`${base}?`)) return path;
  return `${base}${path}`;
}

let current = parseRoute(stripRouteBase(location.pathname));

let search = location.search;

function syncRoute() {
  const next = parseRoute(stripRouteBase(location.pathname));
  const changed = JSON.stringify(next) !== JSON.stringify(current);
  if (changed) current = next;
  if (!changed && search === location.search) return;
  search = location.search;
  signal.publish();
}

addEventListener('popstate', syncRoute);

export function replaceRoute(path: string) {
  history.replaceState(null, '', withRouteBase(path));
  syncRoute();
}

export function navigate(path: string) {
  const full = withRouteBase(path);
  if (full === `${location.pathname}${location.search}`) return;
  history.pushState(null, '', full);
  syncRoute();
}

export function updateSearchParams(
  patch: Record<string, string | null>,
  options: { replace?: boolean } = {}
) {
  const params = new URLSearchParams(location.search);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) params.delete(key);
    else params.set(key, value);
  }
  const query = params.toString();
  const path = `${location.pathname}${query ? `?${query}` : ''}`;
  if (options.replace) replaceRoute(path);
  else navigate(path);
}

export function useSearchParam(name: string) {
  return useSyncExternalStore(signal.subscribe, () => new URLSearchParams(search).get(name));
}

export function useSearchString() {
  return useSyncExternalStore(signal.subscribe, () => search);
}

export const RouteScope = createContext<Route | null>(null);

export function useRoute() {
  const scoped = useContext(RouteScope);
  const live = useSyncExternalStore(signal.subscribe, () => current);
  return scoped ?? live;
}

const followedTasks = new Map<string, string>();

export function selectRouteTask(state: ShinsaState, reference: string) {
  const direct = selectTaskByReference(state, reference);
  if (direct) {
    followedTasks.set(reference, direct.id);
    return direct;
  }
  const followed = followedTasks.get(reference);
  return (followed ? state.tasks[followed] : undefined) ?? null;
}

export function resetFollowedTasks() {
  followedTasks.clear();
}

export function resolveRouteTaskId(state: ShinsaState | null, route: Route) {
  if (route.name !== 'task' || !state) return null;
  return selectRouteTask(state, route.reference)?.id ?? null;
}

export function useRouteTaskId(state: ShinsaState | null) {
  return resolveRouteTaskId(state, useRoute());
}

export interface TaskPathOptions {
  tab?: 'review' | 'code' | 'chat';
  run?: string | null;
  spot?: string | null;
  mode?: 'changes' | 'files';
  file?: string;
  diff?: boolean;
  line?: number | null;
  end?: number | null;
}

export type TaskPathTarget = Pick<Task, 'id'> & { handle?: string | null };

let sharedHandles: ReadonlySet<string> = new Set();

export function replaceSharedHandles(handles: ReadonlySet<string>) {
  sharedHandles = handles;
}

function resolveTaskReference(task: TaskPathTarget) {
  return task.handle && !sharedHandles.has(task.handle) ? task.handle : task.id;
}

export function resolveCanonicalTaskPath(task: TaskPathTarget, segment: string, query: string) {
  if (!task.handle || sharedHandles.has(task.handle) || segment === task.handle) return null;
  return `${resolveTaskPath(task)}${query}`;
}

export function resolveTaskTarget(state: ShinsaState, taskId: string): TaskPathTarget {
  return state.tasks[taskId] ?? { id: taskId };
}

export function resolveAutomationPath(scheduleId: string) {
  return `/automations/${encodeURIComponent(scheduleId)}`;
}

export function resolveTaskPath(task: TaskPathTarget, options: TaskPathOptions = {}) {
  const params = new URLSearchParams();
  if (options.tab) params.set('tab', options.tab);
  if (options.mode) params.set('mode', options.mode);
  if (options.file) params.set('file', options.file);
  if (options.diff) params.set('diff', '1');
  if (options.line) params.set('line', String(options.line));
  if (options.end && options.line && options.end > options.line) params.set('end', String(options.end));
  if (options.spot) params.set('spot', options.spot);
  if (options.run) params.set('run', options.run);
  const query = params.toString();
  return `/tasks/${encodeURIComponent(resolveTaskReference(task))}${query ? `?${query}` : ''}`;
}
