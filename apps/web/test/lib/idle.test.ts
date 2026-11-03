import { afterEach, describe, expect, it } from 'bun:test';
import { scheduleIdle } from '@/lib/idle.ts';

const scope = globalThis as { requestIdleCallback?: unknown; cancelIdleCallback?: unknown };
const saved = { request: scope.requestIdleCallback, cancel: scope.cancelIdleCallback };

afterEach(() => {
  scope.requestIdleCallback = saved.request;
  scope.cancelIdleCallback = saved.cancel;
});

describe('scheduleIdle', () => {
  it('asks the browser for an idle moment within the timeout, and cancels it', async () => {
    const timeouts: number[] = [];
    const cancelled: unknown[] = [];
    scope.requestIdleCallback = (run: () => void, options: { timeout: number }) => {
      timeouts.push(options.timeout);
      return setTimeout(run, 0);
    };
    scope.cancelIdleCallback = (handle: ReturnType<typeof setTimeout>) => {
      cancelled.push(handle);
      clearTimeout(handle);
    };
    const runs: string[] = [];
    scheduleIdle(() => runs.push('idle'), 250);
    scheduleIdle(() => runs.push('cancelled'), 400)();
    await Bun.sleep(5);
    expect(runs).toEqual(['idle']);
    expect(timeouts).toEqual([250, 400]);
    expect(cancelled).toHaveLength(1);
  });

  it('waits the fallback delay without idle callbacks, the timeout when none is given', async () => {
    delete scope.requestIdleCallback;
    const runs: string[] = [];
    scheduleIdle(() => runs.push('fallback'), 200, 0);
    scheduleIdle(() => runs.push('timeout'), 30);
    scheduleIdle(() => runs.push('never'), 0)();
    await Bun.sleep(5);
    expect(runs).toEqual(['fallback']);
    await Bun.sleep(40);
    expect(runs).toEqual(['fallback', 'timeout']);
  });
});
