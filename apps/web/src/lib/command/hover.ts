import type { AccountsSnapshot, ShinsaState } from '@shinsa/core';
import type { Visit } from '@/lib/command/menu.ts';
import { resolveTaskPage } from '@/lib/command/task.ts';
import { findTaskTarget } from '@/lib/tasks/prefetch.ts';
import type { Route } from '@/router.ts';

export const HOVER_SCOPED_ROUTES: ReadonlySet<Route['name']> = new Set(['home', 'tasks']);

let hovered: string | null = null;

export function recordHoveredTask(target: EventTarget | null) {
  hovered = findTaskTarget(target);
}

export function removeHoveredTask() {
  hovered = null;
}

export function resolveHoveredTask(state: ShinsaState, route: Route) {
  if (!hovered || !HOVER_SCOPED_ROUTES.has(route.name)) return null;
  return state.tasks[hovered] ?? null;
}

export function resolveOpeningStack(
  state: ShinsaState,
  route: Route,
  accounts: AccountsSnapshot | null
): Visit[] {
  const task = resolveHoveredTask(state, route);
  return task ? [{ frame: resolveTaskPage(state, task, accounts), from: '' }] : [];
}

export function trackHoveredTasks(paused: () => boolean) {
  const onOver = (event: PointerEvent) => {
    if (!paused()) recordHoveredTask(event.target);
  };
  const onOut = (event: PointerEvent) => {
    if (!paused() && event.relatedTarget === null) removeHoveredTask();
  };
  document.addEventListener('pointerover', onOver);
  document.addEventListener('pointerout', onOut);
  return () => {
    document.removeEventListener('pointerover', onOver);
    document.removeEventListener('pointerout', onOut);
    removeHoveredTask();
  };
}
