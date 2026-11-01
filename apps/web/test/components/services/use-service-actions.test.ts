import { afterEach, describe, expect, it, mock } from 'bun:test';
import { resolveServiceView } from '@shinsa/core';
import { act, renderHook } from '@testing-library/react';
import { useServiceActions } from '@/components/services/use-service-actions.ts';
import { closePreviewShareDialog, usePreviewShareDialog } from '@/lib/share/previews.ts';
import { createProject, createShinsaState, createTask, NOW } from '../../support/state.ts';
import { createService, createTerminal, createTerminalsSnapshot } from '../../support/terminals.ts';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  closePreviewShareDialog();
});

const SHOP = createProject({ id: 'shop', name: 'Shop', key: 'SH' });

describe('useServiceActions', () => {
  it('sends each row and panel action to the engine, and opens a running service’s terminal', async () => {
    const fetch = mock(async (url: string) =>
      Response.json(url.includes('suggestions') ? { suggestions: [] } : createTerminalsSnapshot())
    );
    globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
    const left = mock(() => undefined);
    const { result } = renderHook(() =>
      useServiceActions({ state: createShinsaState({ projects: [SHOP] }), onNavigate: left })
    );
    const { handlers, actions } = result.current;
    const api = createService({ id: 'api' });
    const stopped = resolveServiceView(api, null, NOW);
    const running = resolveServiceView(
      api,
      createTerminal({ id: 't-api', serviceId: 'api', startedAt: NOW }),
      NOW
    );
    handlers.start(stopped);
    handlers.stop(running);
    handlers.restart(running);
    handlers.startAll(SHOP);
    handlers.open(stopped, SHOP);
    expect(left).not.toHaveBeenCalled();
    act(() => handlers.open(running, SHOP));
    expect(left).toHaveBeenCalledTimes(1);
    expect(actions.listPlaces('shop')).toEqual([]);
    const input = {
      name: 'api',
      cwd: '/code',
      command: 'bun dev',
      env: {},
      previewUrl: null,
      portVariable: 'PORT',
    };
    await act(async () => {
      expect(await actions.listSuggestions('shop')).toEqual([]);
      expect(await actions.refineSuggestions('shop')).toBeNull();
      expect(await actions.add('shop', [input])).toBe(true);
      expect(await actions.addOne('shop', input)).toBe(true);
      expect(await actions.update(api, input)).toBe(true);
      expect(await actions.remove([api])).toBe(true);
    });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      '/api/services/api/start',
      '/api/services/api/stop',
      '/api/services/api/restart',
      '/api/services/start-all',
      '/api/services/suggestions?projectId=shop',
      '/api/services/suggestions?projectId=shop&refine=1',
      '/api/services/batch',
      '/api/services',
      '/api/services/api/update',
      '/api/services/remove',
    ]);
  });

  it('opens Share preview for a task’s service and knows which ones are shared', () => {
    const task = createTask({
      id: 'fix',
      previews: [
        { serviceId: 'web', at: 1, url: 'https://a.shinsa.page/?key=k', limit: 'none', endsAt: null },
      ],
    });
    const { result } = renderHook(() => ({
      actions: useServiceActions({ state: createShinsaState({ tasks: [task] }) }),
      opened: usePreviewShareDialog(),
    }));
    const { handlers } = result.current.actions;
    const web = createService({ id: 'web' });
    const own = resolveServiceView(web, null, NOW);
    const shared = resolveServiceView(web, null, NOW, 'fix');
    expect(handlers.sharing?.(shared)).toBe(true);
    expect(handlers.sharing?.(own)).toBe(false);
    expect(handlers.sharing?.(resolveServiceView(web, null, NOW, 'gone'))).toBe(false);
    act(() => handlers.share?.(own));
    expect(result.current.opened).toBeNull();
    act(() => handlers.share?.(shared));
    expect(result.current.opened).toEqual({ taskId: 'fix', serviceId: 'web' });
  });
});
