import { describe, expect, it } from 'bun:test';
import {
  createUsageRecheck,
  DOCUMENT_PAGE,
  RECHECK_FRESH_MS,
  RECHECK_INTERVAL_MS,
  type RecheckPage,
} from '@/lib/accounts/recheck.ts';

function createPage(visible = true) {
  const listeners = new Set<() => void>();
  const state = { visible };
  const page: RecheckPage = {
    isVisible: () => state.visible,
    onVisibilityChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    page,
    listeners,
    show: (next: boolean) => {
      state.visible = next;
      for (const listener of listeners) listener();
    },
  };
}

function createServer() {
  const pending: ((value: unknown) => void)[] = [];
  return {
    pending,
    refresh: () => {
      const answer = Promise.withResolvers<unknown>();
      pending.push(answer.resolve);
      return answer.promise;
    },
    answerAll: () => {
      for (const resolve of pending) resolve(null);
    },
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function until(condition: () => boolean) {
  const deadline = Date.now() + 2_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('The condition never held.');
    await sleep(2);
  }
}

describe('re-checking usage while it is on screen', () => {
  it('checks every minute, after a fresh check stays quiet for five seconds', () => {
    expect(RECHECK_INTERVAL_MS).toBe(60_000);
    expect(RECHECK_FRESH_MS).toBe(5_000);
  });

  it('checks on open, then on its interval, one request at a time, and stops once closed', async () => {
    const server = createServer();
    const { page, listeners } = createPage();
    const recheck = createUsageRecheck({ refresh: server.refresh, intervalMs: 30, page });
    const stop = recheck.watch();
    expect(server.pending).toHaveLength(1);
    const again = recheck.watch();
    const manual = recheck.check();
    expect(server.pending).toHaveLength(1);
    server.answerAll();
    expect(await manual).toEqual({ ok: true });
    await until(() => server.pending.length === 2);
    stop();
    again();
    again();
    expect(listeners.size).toBe(0);
    server.answerAll();
    await sleep(60);
    expect(server.pending).toHaveLength(2);
  });

  it('opening again right after a check does not ask twice, and a failed check says why', async () => {
    const server = createServer();
    const { page } = createPage();
    const recheck = createUsageRecheck({ refresh: server.refresh, intervalMs: 60_000, page });
    const first = recheck.watch();
    server.answerAll();
    await until(() => server.pending.length === 1);
    await sleep(5);
    first();
    const second = recheck.watch();
    expect(server.pending).toHaveLength(1);
    second();
    const broken = createUsageRecheck({ refresh: () => Promise.reject(new Error('offline')), page });
    expect(await broken.check()).toEqual({ ok: false, error: new Error('offline') });
  });

  it('waits while the page is hidden, and checks when it comes back if the last check is old', async () => {
    const server = createServer();
    const { page, show } = createPage(false);
    let now = 1_000_000;
    const recheck = createUsageRecheck({ refresh: server.refresh, intervalMs: 50, page, now: () => now });
    const stop = recheck.watch();
    expect(server.pending).toHaveLength(0);
    show(true);
    expect(server.pending).toHaveLength(1);
    show(false);
    server.answerAll();
    await sleep(80);
    expect(server.pending).toHaveLength(1);
    now += 10;
    show(true);
    expect(server.pending).toHaveLength(1);
    now += 50;
    await until(() => server.pending.length === 2);
    stop();
  });

  it('reads the page’s own visibility and listens to it', () => {
    expect(DOCUMENT_PAGE.isVisible()).toBe(document.visibilityState === 'visible');
    let heard = 0;
    const stop = DOCUMENT_PAGE.onVisibilityChange(() => {
      heard += 1;
    });
    document.dispatchEvent(new Event('visibilitychange'));
    stop();
    document.dispatchEvent(new Event('visibilitychange'));
    expect(heard).toBe(1);
  });
});
