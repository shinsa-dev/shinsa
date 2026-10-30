import { afterEach, describe, expect, it } from 'bun:test';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  dismissHealth,
  type LogProblem,
  refreshHealth,
  resolveHealthBanner,
  type ServerHealth,
  useHealthBanner,
  useServerHealth,
  watchHealth,
} from '@/lib/connection/health.ts';
import { createSignal } from '@/lib/signal.ts';
import { startFakeOnboarding } from '../../support/onboarding.ts';

const UNREADABLE: LogProblem = { seq: 41, type: 'task.staged', kind: 'unreadable', error: 'Not JSON' };

const UNAPPLIABLE: LogProblem = { seq: 57, type: 'run.ended', kind: 'unappliable', error: 'No such run' };

const HEALTHY: ServerHealth = { ok: true, seq: 90, problems: [] };

function createHealth(problems: LogProblem[]): ServerHealth {
  return { ok: problems.length === 0, seq: 90, problems };
}

function createSource(status: 'connecting' | 'open' | 'closed') {
  const signal = createSignal();
  let snapshot = { state: null, status };
  return {
    subscribe: signal.subscribe,
    snapshot: () => snapshot,
    move(next: typeof status) {
      snapshot = { state: null, status: next };
      signal.publish();
    },
  };
}

let fake: ReturnType<typeof startFakeOnboarding> | null = null;

function serveHealth(answer: () => ServerHealth, status = 200) {
  fake = startFakeOnboarding({ 'GET /api/health': { answer, status } });
  return fake;
}

function countReads() {
  return fake?.requests.filter((request) => request.path === '/api/health').length ?? 0;
}

afterEach(async () => {
  serveHealth(() => HEALTHY);
  await act(() => refreshHealth());
  fake?.stop();
  fake = null;
});

describe('the health banner', () => {
  it('says nothing while the log loaded cleanly or before Shinsa answered', () => {
    expect(resolveHealthBanner(null, null)).toBeNull();
    expect(resolveHealthBanner(HEALTHY, null)).toBeNull();
  });

  it('says how many entries were skipped and lists each one with what went wrong', () => {
    expect(resolveHealthBanner(createHealth([UNREADABLE]), null)?.text).toBe(
      'Shinsa skipped a damaged entry in its log at start. Everything else loaded.'
    );
    expect(resolveHealthBanner(createHealth([UNREADABLE, UNAPPLIABLE]), null)).toEqual({
      text: 'Shinsa skipped 2 damaged entries in its log at start. Everything else loaded.',
      problems: [
        { key: '41-unreadable', label: 'Entry 41 · task.staged', detail: 'Unreadable' },
        { key: '57-unappliable', label: 'Entry 57 · run.ended', detail: 'Not applied' },
      ],
    });
  });

  it('names an entry whose type could not be read', () => {
    const banner = resolveHealthBanner(createHealth([{ ...UNREADABLE, type: '' }]), null);
    expect(banner?.problems[0]?.label).toBe('Entry 41 · unknown event');
  });

  it('stays hidden once dismissed, until the problems change', () => {
    expect(resolveHealthBanner(createHealth([UNREADABLE]), '41:unreadable')).toBeNull();
    expect(resolveHealthBanner(createHealth([UNREADABLE, UNAPPLIABLE]), '41:unreadable')).not.toBeNull();
  });
});

describe('reading the health', () => {
  it('reads it at start and again after every reconnect, not on every state push', async () => {
    serveHealth(() => createHealth([UNREADABLE]));
    const source = createSource('open');
    const stop = watchHealth(source);
    await waitFor(() => expect(countReads()).toBe(1));
    source.move('open');
    source.move('closed');
    source.move('connecting');
    expect(countReads()).toBe(1);
    source.move('open');
    await waitFor(() => expect(countReads()).toBe(2));
    stop();
    source.move('closed');
    source.move('open');
    expect(countReads()).toBe(2);
  });

  it('reads it once the first connection opens when it starts closed', async () => {
    serveHealth(() => HEALTHY);
    const source = createSource('connecting');
    const stop = watchHealth(source);
    source.move('open');
    await waitFor(() => expect(countReads()).toBe(2));
    stop();
  });

  it('shows the banner, keeps it when a read fails, and hides it once dismissed', async () => {
    const torn: LogProblem = { seq: 301, type: 'gate.opened', kind: 'unreadable', error: 'Torn' };
    let answer = createHealth([UNREADABLE, UNAPPLIABLE, torn]);
    let failing = false;
    fake = startFakeOnboarding({
      'GET /api/health': {
        answer: () => {
          if (failing) throw new Error('down');
          return answer;
        },
      },
    });
    const { result } = renderHook(() => useHealthBanner());
    await waitFor(() => expect(result.current?.problems).toHaveLength(3));
    failing = true;
    await act(() => refreshHealth());
    expect(result.current?.problems).toHaveLength(3);
    act(() => dismissHealth());
    expect(result.current).toBeNull();
    failing = false;
    await act(() => refreshHealth());
    expect(result.current).toBeNull();
    answer = createHealth([torn]);
    await act(() => refreshHealth());
    expect(result.current?.problems).toHaveLength(1);
  });
});

describe('a dismissal', () => {
  it('is remembered after a reload, until the engine skips other entries', async () => {
    let answer = createHealth([UNREADABLE, UNAPPLIABLE]);
    serveHealth(() => answer);
    const first = renderHook(() => useHealthBanner());
    await waitFor(() => expect(first.result.current?.problems).toHaveLength(2));
    act(() => dismissHealth());
    first.unmount();
    expect(localStorage.getItem('shinsa.health-dismissed')).toBe('41:unreadable,57:unappliable');
    const reloaded = renderHook(() => useHealthBanner());
    await waitFor(() => expect(countReads()).toBe(2));
    expect(reloaded.result.current).toBeNull();
    answer = createHealth([UNREADABLE, UNAPPLIABLE, { ...UNREADABLE, seq: 88 }]);
    await act(() => refreshHealth());
    expect(reloaded.result.current?.problems).toHaveLength(3);
  });
});

describe('useServerHealth', () => {
  it('reads the health the banner keeps', async () => {
    serveHealth(() => createHealth([UNREADABLE]));
    const { result } = renderHook(() => useServerHealth());
    await act(() => refreshHealth());
    expect(result.current?.ok).toBe(false);
  });
});
