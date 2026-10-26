import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import { connection } from '@/lib/connection/socket.ts';
import {
  closeTerminal,
  openTaskTerminal,
  openTerminal,
  renameTerminal,
  reorderTerminals,
  requestTerminalCreate,
  restartTerminal,
  useTerminals,
} from '@/lib/connection/terminals.ts';
import { spyOnToasts } from '../../support/commands.ts';
import { createTask } from '../../support/state.ts';
import { createTerminal, createTerminalState, createTerminalsSnapshot } from '../../support/terminals.ts';

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
