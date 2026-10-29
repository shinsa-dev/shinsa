import { describe, expect, it } from 'bun:test';
import {
  isHubRoute,
  type KeptView,
  listHubViews,
  resolvePageKey,
  updateKeptViews,
} from '@/lib/kept-views.ts';
import type { RouteView } from '@/router.ts';

const HOME: RouteView = { route: { name: 'home' }, search: '' };
const TASKS: RouteView = { route: { name: 'tasks' }, search: '?status=done' };
const SETTINGS: RouteView = { route: { name: 'settings' }, search: '' };
const TASK: RouteView = { route: { name: 'task', reference: 'SW-1' }, search: '?tab=chat' };

function visit(kept: readonly KeptView[], key: string, view: RouteView, limit = 3) {
  return updateKeptViews(kept, key, view, limit);
}

describe('resolvePageKey', () => {
  it('keys a task page by its id, so its handle and id share one page', () => {
    expect(resolvePageKey(TASK, 'task-1')).toBe('task:task-1');
    expect(resolvePageKey(TASK, null)).toBe('task:SW-1');
  });

  it('keys every other page by its name', () => {
    expect(resolvePageKey(HOME, null)).toBe('home');
    expect(resolvePageKey(SETTINGS, null)).toBe('settings');
  });

  it('keys an automation’s page by its schedule', () => {
    expect(resolvePageKey({ route: { name: 'automation', scheduleId: 's1' }, search: '' }, null)).toBe(
      'automation:s1'
    );
  });
});

describe('updateKeptViews', () => {
  it('keeps the pages in the order they were first shown and marks the newest', () => {
    let kept = visit([], 'home', HOME);
    kept = visit(kept, 'tasks', TASKS);
    expect(kept.map((each) => [each.key, each.shownAt])).toEqual([
      ['home', 1],
      ['tasks', 2],
    ]);
    kept = visit(kept, 'home', HOME);
    expect(kept.map((each) => [each.key, each.shownAt])).toEqual([
      ['home', 3],
      ['tasks', 2],
    ]);
  });

  it('returns the same list when nothing changed, so a render can call it freely', () => {
    const kept = visit(visit([], 'home', HOME), 'tasks', TASKS);
    expect(visit(kept, 'tasks', TASKS)).toBe(kept);
  });

  it('remembers the latest URL of the page that is shown', () => {
    const kept = visit(visit([], 'tasks', TASKS), 'tasks', { ...TASKS, search: '?status=open' });
    expect(kept).toEqual([{ key: 'tasks', view: { ...TASKS, search: '?status=open' }, shownAt: 1 }]);
  });

  it('drops the page shown longest ago once the limit is reached', () => {
    let kept = visit([], 'home', HOME);
    kept = visit(kept, 'tasks', TASKS);
    kept = visit(kept, 'settings', SETTINGS);
    kept = visit(kept, 'home', HOME);
    kept = visit(kept, 'task:1', TASK);
    expect(kept.map((each) => each.key)).toEqual(['home', 'settings', 'task:1']);
  });
});

describe('the hub pages', () => {
  it('are Home, All tasks and Settings', () => {
    expect(isHubRoute(HOME.route)).toBe(true);
    expect(isHubRoute(TASKS.route)).toBe(true);
    expect(isHubRoute(SETTINGS.route)).toBe(true);
    expect(isHubRoute(TASK.route)).toBe(false);
    expect(isHubRoute({ name: 'onboarding' })).toBe(false);
  });

  it('keeps the ones you have been to, at the URL you left them', () => {
    expect(listHubViews(new Map([['tasks', TASKS]]), false)).toEqual([
      { key: 'tasks', view: TASKS, shownAt: 0 },
    ]);
  });

  it('warms all four once the page is idle, the terminal page included', () => {
    expect(listHubViews(new Map([['tasks', TASKS]]), true)).toEqual([
      { key: 'home', view: HOME, shownAt: 0 },
      { key: 'tasks', view: TASKS, shownAt: 0 },
      { key: 'settings', view: SETTINGS, shownAt: 0 },
      { key: 'terminal', view: { route: { name: 'terminal' }, search: '' }, shownAt: 0 },
    ]);
  });

  it('keeps the terminal page where you left it', () => {
    const terminal: RouteView = { route: { name: 'terminal' }, search: '?project=SH' };
    expect(isHubRoute(terminal.route)).toBe(true);
    expect(listHubViews(new Map([['terminal', terminal]]), true).map((each) => each.key)).toEqual([
      'home',
      'tasks',
      'settings',
      'terminal',
    ]);
  });
});
