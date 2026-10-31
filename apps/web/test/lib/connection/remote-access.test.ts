import { afterEach, beforeEach, describe, expect, it, type Mock, spyOn } from 'bun:test';
import type { RemoteSnapshot } from '@shinsa/core';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  acceptMachineRequest,
  declineMachineRequest,
  REMOTE_ACCESS_ACTIONS,
  refreshRemoteAccess,
  resetRemoteAccess,
  selectRemoteAccess,
  useRemoteAccess,
} from '@/lib/connection/remote-access.ts';
import { connection } from '@/lib/connection/socket.ts';
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

describe('remote access on this machine', () => {
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

  it('shares one read between callers that ask at once', async () => {
    answerSnapshot('GET /api/remote', createRemoteSnapshot());
    await Promise.all([refreshRemoteAccess(), refreshRemoteAccess()]);
    expect(sent.filter((entry) => entry.path === '/api/remote')).toHaveLength(1);
  });

  it('sends each action to its route and keeps the snapshot it answers with', async () => {
    const paused = createRemoteSnapshot({ enabled: false });
    for (const path of [
      '/pair',
      '/pair/cancel',
      '/enable',
      '/disable',
      '/remove',
      '/devices/remove',
      '/members/remove',
      '/links/create',
      '/links/remove',
      '/requests/accept',
      '/requests/decline',
    ])
      answerSnapshot(`POST /api/remote${path}`, paused);
    await REMOTE_ACCESS_ACTIONS.pair();
    await REMOTE_ACCESS_ACTIONS.cancelPairing();
    await REMOTE_ACCESS_ACTIONS.resume();
    await REMOTE_ACCESS_ACTIONS.pause();
    await REMOTE_ACCESS_ACTIONS.remove();
    await REMOTE_ACCESS_ACTIONS.forgetDevice('dev-1');
    await REMOTE_ACCESS_ACTIONS.createLink('invite');
    await REMOTE_ACCESS_ACTIONS.removeLink('device');
    await REMOTE_ACCESS_ACTIONS.acceptRequest('r1');
    await REMOTE_ACCESS_ACTIONS.declineRequest('r2');
    await REMOTE_ACCESS_ACTIONS.removeMember('7');
    expect(selectRemoteAccess().snapshot).toEqual(paused);
    expect(sent.map((entry) => [entry.path, entry.body])).toEqual([
      ['/api/remote/pair', {}],
      ['/api/remote/pair/cancel', {}],
      ['/api/remote/enable', {}],
      ['/api/remote/disable', {}],
      ['/api/remote/remove', {}],
      ['/api/remote/devices/remove', { publicKey: 'dev-1' }],
      ['/api/remote/links/create', { kind: 'invite' }],
      ['/api/remote/links/remove', { kind: 'device' }],
      ['/api/remote/requests/accept', { requestId: 'r1' }],
      ['/api/remote/requests/decline', { requestId: 'r2' }],
      ['/api/remote/members/remove', { userId: '7' }],
    ]);
  });

  it('sends an answer to a request to the machine it waits on', async () => {
    const snapshot = createRemoteSnapshot();
    answerSnapshot('POST /api/remote/requests/accept?machine=k3x9', snapshot);
    answerSnapshot('POST /api/remote/requests/decline?machine=w4t8', snapshot);
    await acceptMachineRequest('k3x9', 'r1');
    await declineMachineRequest('w4t8', 'r2');
    expect(sent.map((entry) => [entry.path, entry.body])).toEqual([
      ['/api/remote/requests/accept?machine=k3x9', { requestId: 'r1' }],
      ['/api/remote/requests/decline?machine=w4t8', { requestId: 'r2' }],
    ]);
  });

  it('reads once when opened, then shows every snapshot the server pushes without asking again', async () => {
    answerSnapshot('GET /api/remote', createRemoteSnapshot());
    const { result } = renderHook(() => useRemoteAccess());
    await waitFor(() => expect(result.current.snapshot?.status).toBe('connected'));
    const added = createRemoteSnapshot({
      devices: [
        {
          publicKey: 'd',
          name: 'iPhone',
          enrolledAt: 1,
          lastSeenAt: null,
          userId: null,
        },
      ],
    });
    act(() => connection.replaceRemote(added));
    expect(result.current.snapshot).toBe(added);
    expect(sent.filter((entry) => entry.path === '/api/remote')).toHaveLength(1);
  });

  it('never lets the first read replace a newer pushed snapshot, and clears a failure once one arrives', async () => {
    const pushed = createRemoteSnapshot({ enabled: false });
    await refreshRemoteAccess();
    expect(selectRemoteAccess().failure).toBe('Shinsa answered with status 503.');
    connection.replaceRemote(pushed);
    answerSnapshot('GET /api/remote', createRemoteSnapshot());
    await refreshRemoteAccess();
    expect(selectRemoteAccess()).toEqual({ snapshot: pushed, failure: null });
  });
});
