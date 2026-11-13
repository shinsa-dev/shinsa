import { afterEach, beforeEach, describe, expect, it, type Mock, spyOn } from 'bun:test';
import type { SlackSnapshot } from '@shinsa/core';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  refreshSlack,
  resetSlack,
  SLACK_ACTIONS,
  selectSlack,
  sendSlackTests,
  useSlack,
  useSlackDirectory,
} from '@/lib/connection/slack.ts';
import { type FetchRequest, readFetchRequest } from '../../support/fetch.ts';

const SNAPSHOT: SlackSnapshot = {
  remote: true,
  connectUrl: 'https://app.shinsa.dev/slack/connect?instance=k3x9',
  links: [
    { teamId: 'T1', teamName: 'Overclock', userId: 'U1', userName: 'Christo', linkedAt: 1, accountId: null },
  ],
  problem: null,
};

let answers: Record<string, () => Response> = {};
let sent: FetchRequest[] = [];
let fetchSpy: Mock<typeof fetch>;

beforeEach(() => {
  answers = {};
  sent = [];
  fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (
    input: RequestInfo | URL,
    init?: RequestInit
  ) => {
    const call = await readFetchRequest(input, init);
    sent.push(call);
    const { path, method } = call;
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

  it('disconnecting sends an empty JSON body and shows the snapshot the engine answers with', async () => {
    const disconnected = { ...SNAPSHOT, links: [] };
    answers['POST /api/slack/disconnect'] = () => Response.json(disconnected);
    await act(() => SLACK_ACTIONS.disconnect());
    const request = sent.find((entry) => entry.path === '/api/slack/disconnect');
    expect([request?.headers.get('content-type'), request?.body]).toEqual(['application/json', {}]);
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

describe('the Slack directory', () => {
  const DIRECTORY = { teamId: 'T1', channels: [{ id: 'C1', name: 'oncall' }], people: [], problem: null };

  it('reads nothing without a workspace', async () => {
    const { result } = renderHook(() => useSlackDirectory(null));
    await act(async () => {});
    expect(result.current).toBeNull();
    expect(sent.some((entry) => entry.path.startsWith('/api/slack/directory'))).toBe(false);
  });

  it('reads the workspace’s channels and people, again for another workspace', async () => {
    answers['GET /api/slack/directory?teamId=T1'] = () => Response.json(DIRECTORY);
    answers['GET /api/slack/directory?teamId=T2'] = () => Response.json({ ...DIRECTORY, teamId: 'T2' });
    const { result, rerender } = renderHook(({ teamId }) => useSlackDirectory(teamId), {
      initialProps: { teamId: 'T1' },
    });
    await waitFor(() => expect(result.current).toEqual(DIRECTORY));
    rerender({ teamId: 'T2' });
    await waitFor(() => expect(result.current?.teamId).toBe('T2'));
  });

  it('shows an empty directory with the problem when the engine cannot answer', async () => {
    const { result } = renderHook(() => useSlackDirectory('T1'));
    await waitFor(() =>
      expect(result.current).toEqual({
        teamId: 'T1',
        channels: [],
        people: [],
        problem: 'Shinsa answered with status 503.',
      })
    );
  });
});

describe('a test message to Slack', () => {
  const ONCALL = { kind: 'slack_channel' as const, teamId: 'T1', id: 'C1', name: 'oncall' };
  const KAI = { kind: 'slack_person' as const, teamId: 'T1', id: 'U7', name: 'Kai' };

  it('sends one per contact and says how each went, an engine that cannot answer included', async () => {
    let calls = 0;
    answers['POST /api/slack/test'] = () => {
      calls += 1;
      return calls === 1
        ? Response.json({ sent: true, problem: null })
        : new Response('offline', { status: 503 });
    };
    const results = await sendSlackTests([ONCALL, KAI]);
    expect(results[0]).toEqual({ contact: ONCALL, sent: true, problem: null });
    expect(results[1]).toMatchObject({ contact: KAI, sent: false });
    expect(results[1]?.problem).toBeTruthy();
  });
});
