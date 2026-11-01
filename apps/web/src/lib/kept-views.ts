import type { Route, RouteView } from '@/router.ts';

export interface KeptView<Key extends string = string> {
  key: Key;
  view: RouteView;
  shownAt: number;
}

export const KEPT_TASK_PAGES = 3;

const HUB_PAGES = ['home', 'tasks', 'settings', 'terminal'] as const;

const WARM_PAGES: ReadonlySet<string> = new Set(HUB_PAGES);

type HubPage = (typeof HUB_PAGES)[number];

export function isHubRoute(route: Route): route is { name: HubPage } {
  return HUB_PAGES.some((name) => name === route.name);
}

export function resolvePageKey(view: RouteView, taskId: string | null) {
  if (view.route.name === 'task') return `task:${taskId ?? view.route.reference}`;
  if (view.route.name === 'automation') return `automation:${view.route.scheduleId}`;
  if (view.route.name === 'team-task') {
    const { route } = view;
    return `team-task:${route.teamId}/${route.instanceId}/${route.taskId}`;
  }
  return view.route.name;
}

export function listHubViews(visited: ReadonlyMap<string, RouteView>, warm: boolean): KeptView[] {
  return HUB_PAGES.flatMap((name) => {
    const view = visited.get(name) ?? (warm && WARM_PAGES.has(name) ? { route: { name }, search: '' } : null);
    return view ? [{ key: name, view, shownAt: 0 }] : [];
  });
}

export function updateKeptViews<Key extends string>(
  kept: readonly KeptView<Key>[],
  key: Key,
  view: RouteView,
  limit: number
): readonly KeptView<Key>[] {
  const existing = kept.find((each) => each.key === key);
  const latest = Math.max(0, ...kept.map((each) => each.shownAt));
  if (existing && existing.view === view && existing.shownAt === latest) return kept;
  const shownAt = existing?.shownAt === latest ? latest : latest + 1;
  const next = existing
    ? kept.map((each) => (each.key === key ? { key, view, shownAt } : each))
    : [...kept, { key, view, shownAt }];
  if (next.length <= limit) return next;
  const oldest = next.reduce((least, each) => (each.shownAt < least.shownAt ? each : least));
  return next.filter((each) => each !== oldest);
}
