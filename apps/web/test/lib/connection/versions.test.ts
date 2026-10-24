import { afterEach, beforeEach, describe, expect, it, type Mock, spyOn } from 'bun:test';
import type { UpdateStreamLine } from '@shinsa/core';
import { toast } from '@shinsa/ui/components/sonner';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  checkVersions,
  refreshVersions,
  requestUpdate,
  resetVersions,
  selectVersions,
  useVersions,
} from '@/lib/connection/versions.ts';
import { spyOnToasts } from '../../support/commands.ts';
import { createProgram, createVersions } from '../../support/versions.ts';

const SNAPSHOT = createVersions();

const UPDATED = createVersions({ programs: [createProgram({ version: '2.1.310', status: 'current' })] });

type Answer = Response | (() => Response);

let routes: Record<string, Answer> = {};
let sent: { path: string; method: string; body: unknown; accept: string | null }[] = [];
let fetchSpy: Mock<typeof fetch>;
let loading: Mock<typeof toast.loading>;
let toasts: ReturnType<typeof spyOnToasts>;

function streamOf(chunks: string[], fail = false) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      if (fail) controller.error(new Error('reset'));
      else controller.close();
    },
  });
}

function serialize(lines: UpdateStreamLine[]) {
  return lines.map((line) => `${JSON.stringify(line)}\n`).join('');
}

beforeEach(() => {
  resetVersions();
  routes = {};
  sent = [];
  toasts = spyOnToasts();
  loading = spyOn(toast, 'loading').mockReturnValue('update');
  fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (
    input: RequestInfo | URL,
    init?: RequestInit
  ) => {
    const path = String(input);
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);
    sent.push({
      path,
      method,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
      accept: headers.get('accept'),
    });
    const answer = routes[`${method} ${path}`];
    if (!answer) return new Response('offline', { status: 503 });
    return typeof answer === 'function' ? answer() : answer;
  }) as typeof fetch);
});

afterEach(() => {
  act(() => resetVersions());
  fetchSpy.mockRestore();
  loading.mockRestore();
  toasts.restore();
});

describe('reading the versions', () => {
  it('useVersions reads them once while active and shares one request', async () => {
    routes['GET /api/versions'] = () => Response.json(SNAPSHOT);
    const { result } = renderHook(() => useVersions());
    renderHook(() => useVersions(false));
    await waitFor(() => expect(result.current.snapshot).toEqual(SNAPSHOT));
    expect(sent.filter((entry) => entry.path === '/api/versions')).toHaveLength(1);
    await refreshVersions();
    expect(sent.filter((entry) => entry.path === '/api/versions')).toHaveLength(2);
  });

  it('a failed read is kept as the failure, and Check for updates toasts its refusal', async () => {
    await refreshVersions();
    expect(selectVersions().failure).toBe('Shinsa answered with status 503.');
    expect(await checkVersions()).toBe(false);
    expect(toasts.error).toHaveBeenCalledWith('Shinsa answered with status 503.');
    routes['POST /api/versions/refresh'] = Response.json(SNAPSHOT);
    expect(await checkVersions()).toBe(true);
    expect(selectVersions()).toMatchObject({ snapshot: SNAPSHOT, failure: null });
  });
});

describe('updating a program', () => {
  it('streams the updater’s lines into the loading toast, then settles it with the outcome', async () => {
    routes['GET /api/versions'] = Response.json(SNAPSHOT);
    await refreshVersions();
    routes['POST /api/versions/update'] = new Response(
      streamOf([
        serialize([{ type: 'output', line: 'Checking for updates' }]).slice(0, 10),
        serialize([{ type: 'output', line: 'Checking for updates' }]).slice(10),
        serialize([
          { type: 'done', ok: true, message: 'Updated Claude Code to 2.1.310.', versions: UPDATED },
        ]),
      ])
    );
    const update = requestUpdate('claude');
    expect(selectVersions().updating).toEqual(['claude']);
    expect(await requestUpdate('claude')).toBe(false);
    expect(await update).toBe(true);
    expect(sent.at(-1)).toMatchObject({
      path: '/api/versions/update',
      method: 'POST',
      body: { program: 'claude' },
      accept: 'application/x-ndjson',
    });
    expect(loading.mock.calls).toEqual([
      ['Updating Claude Code', { description: 'Running claude update.' }],
      ['Updating Claude Code', { id: 'update', description: 'Checking for updates' }],
    ]);
    expect(toasts.success).toHaveBeenCalledWith('Updated Claude Code to 2.1.310.', { id: 'update' });
    expect(selectVersions()).toMatchObject({ snapshot: UPDATED, updating: [] });
  });

  it('an update that did not take settles as an error, with the versions it read', async () => {
    routes['POST /api/versions/update'] = new Response(
      streamOf([
        serialize([
          { type: 'done', ok: false, message: 'Couldn’t update Codex: denied', versions: SNAPSHOT },
        ]),
      ])
    );
    expect(await requestUpdate('codex')).toBe(false);
    expect(loading).toHaveBeenCalledWith('Updating Codex', { description: 'Starting the update.' });
    expect(toasts.error).toHaveBeenCalledWith('Couldn’t update Codex: denied', { id: 'update' });
    expect(selectVersions().snapshot).toEqual(SNAPSHOT);
  });

  it('a refusal, a broken stream or one that never says how it went is an error toast', async () => {
    routes['POST /api/versions/update'] = Response.json(
      { error: { code: 'update_running', message: 'Claude Code is already updating.' } },
      { status: 400 }
    );
    expect(await requestUpdate('claude')).toBe(false);
    expect(toasts.error).toHaveBeenLastCalledWith('Claude Code is already updating.', { id: 'update' });
    routes['POST /api/versions/update'] = new Response(streamOf(['{"type":"output","line":"a"}\n'], true));
    expect(await requestUpdate('claude')).toBe(false);
    expect(toasts.error).toHaveBeenLastCalledWith('Shinsa stopped answering.', { id: 'update' });
    routes['POST /api/versions/update'] = new Response(streamOf(['{"type":"output","line":"a"}']));
    expect(await requestUpdate('claude')).toBe(false);
    expect(toasts.error).toHaveBeenLastCalledWith('The update ended without saying how it went.', {
      id: 'update',
    });
    routes['POST /api/versions/update'] = new Response(null);
    expect(await requestUpdate('claude')).toBe(false);
    expect(selectVersions().updating).toEqual([]);
  });

  it('Shinsa out of reach is an error toast too', async () => {
    fetchSpy.mockImplementation((() =>
      Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch);
    expect(await requestUpdate('claude')).toBe(false);
    expect(toasts.error).toHaveBeenCalledWith('Couldn’t reach Shinsa.', { id: 'update' });
  });
});
