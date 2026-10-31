import { afterEach, beforeEach, describe, expect, it, type Mock, spyOn } from 'bun:test';
import type { SlackSnapshot } from '@shinsa/core';
import { act, renderHook, waitFor } from '@testing-library/react';
import { refreshSlack, resetSlack, SLACK_ACTIONS, selectSlack, useSlack } from '@/lib/connection/slack.ts';

const SNAPSHOT: SlackSnapshot = {
  remote: true,
  connectUrl: 'https://app.shinsa.dev/slack/connect?instance=k3x9',
  links: [{ teamId: 'T1', teamName: 'Overclock', userId: 'U1', userName: 'Christo', linkedAt: 1 }],
  problem: null,
};

let answers: Record<string, () => Response> = {};
let sent: { path: string; method: string }[] = [];
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
    sent.push({ path, method });
    const answer = answers[`${method} ${path}`];
    return answer ? answer() : new Response('offline', { status: 503 });
  }) as typeof fetch);
});

afterEach(() => {
  act(() => resetSlack());
  fetchSpy.mockRestore();
});

describe('Slack on this machine', () => {
  it('reads the snapshot, and keeps the last one with the failure when a read fails', async () => {
    answers['GET /api/slack'] = () => Response.json(SNAPSHOT);
    await refreshSlack();
    expect(selectSlack()).toEqual({ snapshot: SNAPSHOT, failure: null });
    answers = {};
    await refreshSlack();
    expect(selectSlack()).toEqual({ snapshot: SNAPSHOT, failure: 'Shinsa answered with status 503.' });
  });

  it('shares one read between callers that ask at once', async () => {
    answers['GET /api/slack'] = () => Response.json(SNAPSHOT);
    await Promise.all([refreshSlack(), refreshSlack()]);
    expect(sent.filter((entry) => entry.path === '/api/slack')).toHaveLength(1);
  });

  it('disconnecting shows the snapshot the engine answers with', async () => {
    const disconnected = { ...SNAPSHOT, links: [] };
    answers['POST /api/slack/disconnect'] = () => Response.json(disconnected);
    await act(() => SLACK_ACTIONS.disconnect());
    expect(selectSlack().snapshot).toEqual(disconnected);
  });

  it('reads on mount and again when the window comes back, as after connecting in the browser', async () => {
    answers['GET /api/slack'] = () => Response.json(SNAPSHOT);
    const { result } = renderHook(() => useSlack());
    await waitFor(() => expect(result.current.snapshot).toEqual(SNAPSHOT));
    const reads = () => sent.filter((entry) => entry.path === '/api/slack').length;
    const before = reads();
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(reads()).toBe(before + 1));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    expect(reads()).toBe(before + 1);
  });
});
