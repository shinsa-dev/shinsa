import { afterEach, describe, expect, it, mock } from 'bun:test';
import { resolveServiceView } from '@shinsa/core';
import { act, renderHook } from '@testing-library/react';
import { useServiceActions } from '@/components/services/use-service-actions.ts';
import { createProject, createShinsaState, NOW } from '../../support/state.ts';
import { createService, createTerminal, createTerminalsSnapshot } from '../../support/terminals.ts';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
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
    const input = { name: 'api', cwd: '/code', command: 'bun dev', env: {} };
    await act(async () => {
      expect(await actions.listSuggestions('shop')).toEqual([]);
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
      '/api/services/batch',
      '/api/services',
      '/api/services/api/update',
      '/api/services/remove',
    ]);
  });
});
