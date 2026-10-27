import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import { connection } from '@/lib/connection/socket.ts';
import {
  closeTerminal,
  openServiceTerminal,
  openTaskTerminal,
  openTerminal,
  renameTerminal,
  reorderTerminals,
  requestServiceAdd,
  requestServiceSuggestions,
  requestServicesAdd,
  requestServicesRemove,
  requestServiceUpdate,
  requestTerminalCreate,
  requestTerminalForeground,
  restartService,
  restartTerminal,
  selectTaskTerminal,
  startAllServices,
  startService,
  stopService,
  useTerminals,
} from '@/lib/connection/terminals.ts';
import { spyOnToasts } from '../../support/commands.ts';
import { createTask } from '../../support/state.ts';
import {
  createService,
  createTerminal,
  createTerminalState,
  createTerminalsSnapshot,
} from '../../support/terminals.ts';

const realFetch = globalThis.fetch;

const TERMINAL = createTerminal({ id: 'one' });

const PLACE = { path: '/Users/you/Developer/web', label: 'web', kind: 'repository', taskId: null } as const;

let toasts: ReturnType<typeof spyOnToasts>;

beforeEach(() => {
  toasts = spyOnToasts();
});

afterEach(() => {
  toasts.restore();
  globalThis.fetch = realFetch;
});

function serve(body: unknown, status = 200) {
  const fetch = mock(async (_url: string, _init?: RequestInit) => Response.json(body, { status }));
  globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
  return fetch;
}

function readCall(fetch: ReturnType<typeof serve>, index = 0) {
  const [url, init] = fetch.mock.calls[index] ?? [];
  return { url, body: JSON.parse(String(init?.body)) };
}

describe('useTerminals', () => {
  it('reads the snapshot the socket holds and renders again when it changes', () => {
    const { result } = renderHook(() => useTerminals());
    act(() => connection.replaceTerminals(createTerminalsSnapshot([TERMINAL])));
    expect(result.current?.terminals).toEqual([TERMINAL]);
  });
});

describe('opening a terminal', () => {
  it('asks the engine for a terminal in a place, runs a command in it and keeps the new list', async () => {
    const fetch = serve({ terminal: TERMINAL, ...createTerminalsSnapshot([TERMINAL]) });
    expect(await requestTerminalCreate('shop', PLACE, 'bun dev')).toEqual(TERMINAL);
    expect(readCall(fetch)).toEqual({
      url: '/api/terminals',
      body: { projectId: 'shop', path: PLACE.path, command: 'bun dev' },
    });
    expect(connection.selectTerminals()?.terminals).toEqual([TERMINAL]);
  });

  it('opens it and goes to its tab', async () => {
    const fetch = serve({ terminal: TERMINAL, ...createTerminalsSnapshot([TERMINAL]) });
    expect(await openTerminal('SH', 'shop', PLACE)).toBe(true);
    expect(readCall(fetch).body).toEqual({ projectId: 'shop', path: PLACE.path });
    expect(`${location.pathname}${location.search}`).toBe('/terminal?project=SH&terminal=one');
  });

  it('opens a task’s terminal in its worktree, in its project', async () => {
    const state = createTerminalState();
    const snapshot = spyOn(connection, 'snapshot').mockReturnValue({ state, status: 'open' });
    const fetch = serve({ terminal: TERMINAL, ...createTerminalsSnapshot([TERMINAL]) });
    expect(await openTaskTerminal(state.tasks.fix as never, 'gh auth login')).toBe(true);
    expect(readCall(fetch).body).toMatchObject({ projectId: 'shop', command: 'gh auth login' });
    expect(location.search).toBe('?project=SH&terminal=one');
    snapshot.mockRestore();
  });

  it('finds where a task’s commands run: its worktree in its project, or nowhere', () => {
    const state = createTerminalState();
    expect(selectTaskTerminal(state, state.tasks.fix as never)).toMatchObject({
      project: { id: 'shop' },
      place: { path: '/Users/you/.config/shinsa/data/worktrees/fix', kind: 'worktree' },
    });
    expect(selectTaskTerminal(state, createTask({ id: 'loose' }))).toBeNull();
    expect(selectTaskTerminal(null, state.tasks.fix as never)).toBeNull();
  });

  it('says so for a task with nowhere to open one, or before Shinsa has its state', async () => {
    const state = createTerminalState();
    const snapshot = spyOn(connection, 'snapshot').mockReturnValue({ state, status: 'open' });
    expect(await openTaskTerminal(createTask({ id: 'loose' }))).toBe(false);
    expect(toasts.error).toHaveBeenCalledWith('This task has no project folder to open a terminal in.');
    snapshot.mockReturnValue({ state: null, status: 'connecting' });
    expect(await openTaskTerminal(createTask({ id: 'loose' }))).toBe(false);
    snapshot.mockRestore();
  });
});

describe('changing terminals', () => {
  it('renames, restarts, closes and orders through the engine and keeps its answer', async () => {
    const fetch = serve(createTerminalsSnapshot([TERMINAL]));
    expect(await renameTerminal('one', 'Server')).toBe(true);
    expect(await restartTerminal('one')).toBe(true);
    expect(await closeTerminal('one')).toBe(true);
    expect(await reorderTerminals('shop', ['one'])).toBe(true);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      '/api/terminals/one/rename',
      '/api/terminals/one/restart',
      '/api/terminals/one/close',
      '/api/terminals/order',
    ]);
    expect(readCall(fetch, 0).body).toEqual({ name: 'Server' });
    expect(readCall(fetch, 3).body).toEqual({ projectId: 'shop', ids: ['one'] });
  });

  it('shows the engine’s reason when it refuses', async () => {
    serve({ error: { message: 'That terminal is closed.' } }, 404);
    expect(await closeTerminal('one')).toBe(false);
    expect(toasts.error).toHaveBeenCalledWith('That terminal is closed.');
  });
});

describe('services', () => {
  const API = createService({ id: 'api' });
  const INPUT = { name: 'api', cwd: API.cwd, command: 'bun run dev', env: { PORT: '4000' } };

  it('reads what runs in front of a shell and what the engine found to suggest', async () => {
    let fetch = serve({ program: 'vim' });
    expect(await requestTerminalForeground('one')).toEqual({ program: 'vim' });
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/terminals/one/foreground');
    const suggestion = {
      name: 'web',
      cwd: '/web',
      command: 'bun run dev',
      source: 'package' as const,
      recommended: true,
    };
    fetch = serve({ suggestions: [suggestion] });
    expect(await requestServiceSuggestions('shop')).toEqual([suggestion]);
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/services/suggestions?projectId=shop');
  });

  it('adds and edits a service with its folder as the path, and keeps the new list', async () => {
    let fetch = serve({ service: API, ...createTerminalsSnapshot([], [API]) });
    expect(await requestServiceAdd('shop', INPUT)).toEqual(API);
    expect(readCall(fetch)).toEqual({
      url: '/api/services',
      body: { projectId: 'shop', name: 'api', path: API.cwd, command: 'bun run dev', env: { PORT: '4000' } },
    });
    expect(connection.selectTerminals()?.services).toEqual([API]);
    fetch = serve({ added: [API], ...createTerminalsSnapshot([], [API]) });
    expect(await requestServicesAdd('shop', [INPUT])).toEqual([API]);
    expect(readCall(fetch)).toEqual({
      url: '/api/services/batch',
      body: {
        projectId: 'shop',
        services: [{ name: 'api', path: API.cwd, command: 'bun run dev', env: { PORT: '4000' } }],
      },
    });
    fetch = serve(createTerminalsSnapshot([], [API]));
    await requestServiceUpdate('api', INPUT);
    expect(readCall(fetch).url).toBe('/api/services/api/update');
  });

  it('starts, restarts, stops, starts all and removes through the engine', async () => {
    const terminal = createTerminal({ id: 'svc', serviceId: 'api' });
    let fetch = serve({ terminal, ...createTerminalsSnapshot([terminal], [API]) });
    expect(await startService('api')).toBe(true);
    expect(await restartService('api')).toBe(true);
    expect(connection.selectTerminals()?.terminals).toEqual([terminal]);
    fetch = serve(createTerminalsSnapshot([terminal], [API]));
    expect(await stopService('api')).toBe(true);
    expect(await startAllServices('shop')).toBe(true);
    await requestServicesRemove(['api', 'web']);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      '/api/services/api/stop',
      '/api/services/start-all',
      '/api/services/remove',
    ]);
    expect(readCall(fetch, 1).body).toEqual({ projectId: 'shop' });
    expect(readCall(fetch, 2).body).toEqual({ ids: ['api', 'web'] });
  });

  it('opens a service’s terminal on its tab', () => {
    openServiceTerminal('SH', 'svc');
    expect(location.search).toBe('?project=SH&terminal=svc');
  });
});
