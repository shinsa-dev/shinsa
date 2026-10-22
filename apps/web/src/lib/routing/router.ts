import { useSyncExternalStore } from 'react';
import { createSignal } from '@/lib/state/signal.ts';

export type Route =
  | { name: 'home' }
  | { name: 'gate'; gateId: string }
  | { name: 'tasks' }
  | { name: 'task'; taskId: string }
  | { name: 'settings' }
  | { name: 'ui' };

const signal = createSignal();

export function parseRoute(pathname: string): Route {
  const gate = /^\/gates\/([^/]+)$/.exec(pathname);
  if (gate?.[1]) return { name: 'gate', gateId: decodeURIComponent(gate[1]) };
  const task = /^\/tasks\/([^/]+)$/.exec(pathname);
  if (task?.[1]) return { name: 'task', taskId: decodeURIComponent(task[1]) };
  if (pathname === '/tasks') return { name: 'tasks' };
  if (pathname === '/settings') return { name: 'settings' };
  if (pathname === '/ui') return { name: 'ui' };
  return { name: 'home' };
}

let current = parseRoute(location.pathname);

let search = location.search;

export function syncRoute() {
  const next = parseRoute(location.pathname);
  const changed = JSON.stringify(next) !== JSON.stringify(current);
  if (changed) current = next;
  if (!changed && search === location.search) return;
  search = location.search;
  signal.publish();
}

addEventListener('popstate', syncRoute);

export function replaceRoute(path: string) {
  history.replaceState(null, '', path);
  syncRoute();
}

export function navigate(path: string) {
  if (path === `${location.pathname}${location.search}`) return;
  history.pushState(null, '', path);
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

export function useRoute() {
  return useSyncExternalStore(signal.subscribe, () => current);
}
