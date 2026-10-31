import { type ShinsaState, selectTaskByReference, type Task } from '@shinsa/core';
import { createContext, useContext, useSyncExternalStore } from 'react';
import { createSignal } from '@/lib/signal.ts';

export type Route =
  | { name: 'home' }
  | { name: 'tasks' }
  | { name: 'task'; reference: string }
  | { name: 'sharePreview'; reference: string }
  | { name: 'automation'; scheduleId: string }
  | { name: 'settings' }
  | { name: 'terminal' }
  | { name: 'onboarding' }
  | { name: 'ui' };

export interface RouteView {
  route: Route;
  search: string;
}

const signal = createSignal();

function parseSegment(pattern: RegExp, pathname: string) {
  const segment = pattern.exec(pathname)?.[1];
  if (!segment) return null;
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

export function parseRoute(pathname: string): Route {
  const reference = parseSegment(/^\/tasks\/([^/]+)$/, pathname);
  if (reference) return { name: 'task', reference };
  const shared = parseSegment(/^\/tasks\/([^/]+)\/shared$/, pathname);
  if (shared) return { name: 'sharePreview', reference: shared };
  const scheduleId = parseSegment(/^\/automations\/([^/]+)$/, pathname);
  if (scheduleId) return { name: 'automation', scheduleId };
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

export function resolveRouteTaskId(state: ShinsaState | null, route: Route) {
  if (route.name !== 'task' || !state) return null;
  return selectTaskByReference(state, route.reference)?.id ?? null;
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

export function resolveSharePreviewPath(task: TaskPathTarget) {
  return `/tasks/${encodeURIComponent(resolveTaskReference(task))}/shared`;
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
