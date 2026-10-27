import { describe, expect, it } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import {
  navigate,
  parseRoute,
  RouteScope,
  replaceRoute,
  resolveCanonicalTaskPath,
  resolveRouteTaskId,
  resolveTaskPath,
  resolveTaskTarget,
  updateSearchParams,
  useRoute,
  useRouteTaskId,
  useSearchParam,
} from '@/router.ts';
import { createShinsaState, createTask } from './support/state.ts';

describe('parseRoute', () => {
  it('reads every route the app has', () => {
    expect(parseRoute('/')).toEqual({ name: 'home' });
    expect(parseRoute('/tasks')).toEqual({ name: 'tasks' });
    expect(parseRoute('/tasks/t1')).toEqual({ name: 'task', reference: 't1' });
    expect(parseRoute('/settings')).toEqual({ name: 'settings' });
    expect(parseRoute('/terminal')).toEqual({ name: 'terminal' });
    expect(parseRoute('/onboarding')).toEqual({ name: 'onboarding' });
    expect(parseRoute('/ui')).toEqual({ name: 'ui' });
  });

  it('decodes an encoded task reference', () => {
    expect(parseRoute('/tasks/a%2Fb%20c')).toEqual({ name: 'task', reference: 'a/b c' });
  });

  it('sends unknown and nested paths home', () => {
    expect(parseRoute('/nowhere')).toEqual({ name: 'home' });
    expect(parseRoute('/tasks/t1/extra')).toEqual({ name: 'home' });
    expect(parseRoute('/tasks/')).toEqual({ name: 'home' });
  });

  it('sends a malformed id home instead of throwing', () => {
    expect(parseRoute('/tasks/%E0%A4%A')).toEqual({ name: 'home' });
  });
});

describe('navigate', () => {
  it('pushes a new history entry and updates the route', () => {
    const { result } = renderHook(() => useRoute());
    const before = history.length;
    act(() => navigate('/tasks/t1'));
    expect(result.current).toEqual({ name: 'task', reference: 't1' });
    expect(location.pathname).toBe('/tasks/t1');
    expect(history.length).toBe(before + 1);
  });

  it('does not push a duplicate entry for the page you are on', () => {
    navigate('/tasks?status=done');
    const before = history.length;
    navigate('/tasks?status=done');
    expect(history.length).toBe(before);
  });

  it('keeps the same route object when only the query changes', () => {
    const { result } = renderHook(() => useRoute());
    act(() => navigate('/tasks'));
    const route = result.current;
    act(() => navigate('/tasks?q=fix'));
    expect(result.current).toBe(route);
  });
});

describe('replaceRoute', () => {
  it('replaces the entry instead of pushing one', () => {
    const before = history.length;
    const { result } = renderHook(() => useRoute());
    act(() => replaceRoute('/settings'));
    expect(result.current).toEqual({ name: 'settings' });
    expect(history.length).toBe(before);
  });
});

describe('updateSearchParams', () => {
  it('sets and deletes params and pushes the result', () => {
    navigate('/tasks?status=done&q=old');
    const before = history.length;
    updateSearchParams({ q: null, status: 'review' });
    expect(location.search).toBe('?status=review');
    expect(history.length).toBe(before + 1);
  });

  it('drops the question mark when nothing is left', () => {
    navigate('/tasks?q=old');
    updateSearchParams({ q: null });
    expect(`${location.pathname}${location.search}`).toBe('/tasks');
  });

  it('replaces the entry when asked to', () => {
    navigate('/tasks');
    const before = history.length;
    updateSearchParams({ q: 'login' }, { replace: true });
    expect(location.search).toBe('?q=login');
    expect(history.length).toBe(before);
  });
});

describe('useSearchParam', () => {
  it('follows the query string as it changes', () => {
    const { result } = renderHook(() => useSearchParam('q'));
    expect(result.current).toBeNull();
    act(() => updateSearchParams({ q: 'login' }));
    expect(result.current).toBe('login');
    act(() => updateSearchParams({ q: null }));
    expect(result.current).toBeNull();
  });
});

describe('popstate', () => {
  it('syncs the route when the browser goes back', () => {
    const { result } = renderHook(() => useRoute());
    act(() => navigate('/settings'));
    act(() => {
      history.replaceState(null, '', '/tasks/t9?tab=code');
      dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(result.current).toEqual({ name: 'task', reference: 't9' });
  });

  it('notifies search param readers when only the query moved', () => {
    const { result } = renderHook(() => useSearchParam('tab'));
    act(() => {
      history.replaceState(null, '', '/?tab=chat');
      dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(result.current).toBe('chat');
  });
});

describe('resolveTaskPath', () => {
  it('links to the overview without options', () => {
    expect(resolveTaskPath({ id: 't1' })).toBe('/tasks/t1');
  });

  it('uses the handle when the task has one, and the id until then', () => {
    expect(resolveTaskPath({ id: 't1', handle: 'SW-142' })).toBe('/tasks/SW-142');
    expect(resolveTaskPath({ id: 't1', handle: null })).toBe('/tasks/t1');
  });

  it('encodes the task id', () => {
    expect(resolveTaskPath({ id: 'a/b' })).toBe('/tasks/a%2Fb');
  });

  it('writes tab, mode, file, its lines and run in that order', () => {
    expect(
      resolveTaskPath(
        { id: 't1' },
        { run: 'r1', file: 'src/a.ts', mode: 'changes', diff: true, line: 4, end: 9, tab: 'code' }
      )
    ).toBe('/tasks/t1?tab=code&mode=changes&file=src%2Fa.ts&diff=1&line=4&end=9&run=r1');
    expect(resolveTaskPath({ id: 't1' }, { tab: 'code', mode: 'files', file: 'a.ts', line: 4, end: 4 })).toBe(
      '/tasks/t1?tab=code&mode=files&file=a.ts&line=4'
    );
  });

  it('leaves out a null run', () => {
    expect(resolveTaskPath({ id: 't1' }, { tab: 'chat', run: null })).toBe('/tasks/t1?tab=chat');
  });
});

describe('resolveCanonicalTaskPath', () => {
  it('moves an id or a differently written handle to the handle, keeping the query', () => {
    const task = { id: 't1', handle: 'SW-142' };
    expect(resolveCanonicalTaskPath(task, 't1', '?tab=chat')).toBe('/tasks/SW-142?tab=chat');
    expect(resolveCanonicalTaskPath(task, 'sw-142', '')).toBe('/tasks/SW-142');
  });

  it('leaves the handle itself and a task with no handle where they are', () => {
    expect(resolveCanonicalTaskPath({ id: 't1', handle: 'SW-142' }, 'SW-142', '')).toBeNull();
    expect(resolveCanonicalTaskPath({ id: 't1', handle: null }, 't1', '')).toBeNull();
  });
});

describe('resolveTaskTarget', () => {
  it('finds the task to link to, and falls back to the id when it is gone', () => {
    const state = createShinsaState({ tasks: [createTask({ id: 't1', handle: 'SW-1' })] });
    expect(resolveTaskPath(resolveTaskTarget(state, 't1'))).toBe('/tasks/SW-1');
    expect(resolveTaskPath(resolveTaskTarget(state, 'gone'))).toBe('/tasks/gone');
  });
});

describe('resolveRouteTaskId', () => {
  const state = createShinsaState({ tasks: [createTask({ id: 't1', handle: 'SW-1' })] });

  it('reads the task id from a handle or an id in the URL', () => {
    expect(resolveRouteTaskId(state, parseRoute('/tasks/SW-1'))).toBe('t1');
    expect(resolveRouteTaskId(state, parseRoute('/tasks/t1'))).toBe('t1');
  });

  it('is null off a task page, for an unknown task and before the first state', () => {
    expect(resolveRouteTaskId(state, parseRoute('/tasks'))).toBeNull();
    expect(resolveRouteTaskId(state, parseRoute('/tasks/SW-9'))).toBeNull();
    expect(resolveRouteTaskId(null, parseRoute('/tasks/t1'))).toBeNull();
  });

  it('follows the route as it changes', () => {
    const { result } = renderHook(() => useRouteTaskId(state));
    act(() => navigate('/tasks/SW-1'));
    expect(result.current).toBe('t1');
    act(() => navigate('/settings'));
    expect(result.current).toBeNull();
  });
});

describe('RouteScope', () => {
  it('renders a subtree at its own route while the page stays where it is', () => {
    act(() => navigate('/'));
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(RouteScope, { value: parseRoute('/tasks/SW-1') }, children);
    const state = createShinsaState({ tasks: [createTask({ id: 't1', handle: 'SW-1' })] });
    const scoped = renderHook(() => [useRoute(), useRouteTaskId(state)], { wrapper });
    expect(scoped.result.current).toEqual([{ name: 'task', reference: 'SW-1' }, 't1']);
    act(() => navigate('/settings'));
    expect(scoped.result.current).toEqual([{ name: 'task', reference: 'SW-1' }, 't1']);
    expect(renderHook(() => useRoute()).result.current).toEqual({ name: 'settings' });
  });
});
