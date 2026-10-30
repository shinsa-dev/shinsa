import { afterEach, beforeEach, describe, expect, it, jest, type Mock, spyOn } from 'bun:test';
import type { RemoteSnapshot } from '@shinsa/core';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  REMOTE_ACCESS_ACTIONS,
  refreshRemoteAccess,
  resetRemoteAccess,
  selectRemoteAccess,
  useRemoteAccess,
} from '@/lib/connection/remote-access.ts';
import { REMOTE_POLL_MS } from '@/lib/remote-access.ts';
import { createRemoteSnapshot } from '../../support/remote-access.ts';

let answers: Record<string, () => Response> = {};
let sent: { path: string; method: string; body: unknown }[] = [];
let fetchSpy: Mock<typeof fetch>;

beforeEach(() => {
  answers = {};
  sent = [];
  fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (
    input: RequestInfo | URL,
    init?: RequestInit
  ) => {
    const path = String(input);
    const method = init?.method ?? 'GET';
    sent.push({ path, method, body: typeof init?.body === 'string' ? JSON.parse(init.body) : null });
    const answer = answers[`${method} ${path}`];
    return answer ? answer() : new Response('offline', { status: 503 });
  }) as typeof fetch);
});

afterEach(() => {
  act(() => resetRemoteAccess());
  fetchSpy.mockRestore();
});

function answerSnapshot(key: string, snapshot: RemoteSnapshot) {
  answers[key] = () => Response.json(snapshot);
}

describe('remote access on this Mac', () => {
  it('reads the snapshot, and keeps the last one with the failure when a read fails', async () => {
    answerSnapshot('GET /api/remote', createRemoteSnapshot());
    await refreshRemoteAccess();
    expect(selectRemoteAccess()).toEqual({ snapshot: createRemoteSnapshot(), failure: null });
    answers = {};
    await refreshRemoteAccess();
    expect(selectRemoteAccess()).toEqual({
      snapshot: createRemoteSnapshot(),
      failure: 'Shinsa answered with status 503.',
    });
  });

  it('sends each action to its route and keeps the snapshot it answers with', async () => {
    const paused = createRemoteSnapshot({ enabled: false });
    for (const path of ['/pair', '/pair/cancel', '/enable', '/disable', '/remove', '/devices/remove'])
      answerSnapshot(`POST /api/remote${path}`, paused);
    answers['POST /api/remote/devices/enroll'] = () =>
      Response.json({ url: 'https://app.shinsa.dev/enroll#a.b.c', name: 'iPhone', expiresAt: 1 });
    await REMOTE_ACCESS_ACTIONS.pair();
    await REMOTE_ACCESS_ACTIONS.cancelPairing();
    await REMOTE_ACCESS_ACTIONS.resume();
    await REMOTE_ACCESS_ACTIONS.pause();
    await REMOTE_ACCESS_ACTIONS.remove();
    await REMOTE_ACCESS_ACTIONS.forgetDevice('dev-1');
    expect(await REMOTE_ACCESS_ACTIONS.createEnrollment('iPhone')).toMatchObject({ name: 'iPhone' });
    expect(selectRemoteAccess().snapshot).toEqual(paused);
    expect(sent.map((entry) => [entry.path, entry.body])).toEqual([
      ['/api/remote/pair', {}],
      ['/api/remote/pair/cancel', {}],
      ['/api/remote/enable', {}],
      ['/api/remote/disable', {}],
      ['/api/remote/remove', {}],
      ['/api/remote/devices/remove', { publicKey: 'dev-1' }],
      ['/api/remote/devices/enroll', { name: 'iPhone' }],
    ]);
  });

  it('reads once while open, and again every few seconds only while pairing or connecting', async () => {
    jest.useFakeTimers();
    answerSnapshot('GET /api/remote', createRemoteSnapshot({ status: 'starting' }));
    const { result, unmount } = renderHook(() => useRemoteAccess());
    await waitFor(() => expect(result.current.snapshot?.status).toBe('starting'));
    const reads = () => sent.filter((entry) => entry.path === '/api/remote').length;
    const before = reads();
    answerSnapshot('GET /api/remote', createRemoteSnapshot());
    await act(async () => {
      jest.advanceTimersByTime(REMOTE_POLL_MS);
    });
    await waitFor(() => expect(result.current.snapshot?.status).toBe('connected'));
    expect(reads()).toBeGreaterThan(before);
    const settled = reads();
    await act(async () => {
      jest.advanceTimersByTime(REMOTE_POLL_MS * 3);
    });
    expect(reads()).toBe(settled);
    unmount();
    renderHook(() => useRemoteAccess(false));
    expect(reads()).toBe(settled);
  });
});
