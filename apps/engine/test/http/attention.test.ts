import { describe, expect, test } from 'bun:test';
import type { AttentionPlace, ScopedActor, RequestOrigin } from '@shinsa/core';
import { ATTENTION_IDLE_MS, AttentionTracker } from '../../src/http/attention.ts';

interface Page {
  name: string;
  data: { origin: RequestOrigin; guest: ScopedActor | null };
}

function createClock() {
  let now = 1_000;
  const timers: { at: number; run: () => void; cancelled: boolean }[] = [];
  return {
    clock: {
      now: () => now,
      schedule: (delayMs: number, run: () => void) => {
        const timer = { at: now + delayMs, run, cancelled: false };
        timers.push(timer);
        return () => {
          timer.cancelled = true;
        };
      },
    },
    advance(ms: number) {
      now += ms;
      for (const timer of timers.splice(0)) {
        if (timer.cancelled) continue;
        if (timer.at <= now) timer.run();
        else timers.push(timer);
      }
    },
    pending: () => timers.filter((timer) => !timer.cancelled).length,
  };
}

function createPage(name: string, origin: RequestOrigin, guest: ScopedActor | null = null): Page {
  return { name, data: { origin, guest } };
}

function createTracker() {
  const told: string[] = [];
  const time = createClock();
  const tracker = new AttentionTracker<Page>(
    (page, where: AttentionPlace) => told.push(`${page.name}:${where}`),
    time.clock
  );
  return { tracker, told, time };
}

describe('the attention tracker', () => {
  test('tells the page you used last that it is here and every other page of yours that you are elsewhere', () => {
    const { tracker, told, time } = createTracker();
    const app = createPage('app', 'local');
    const laptop = createPage('laptop', 'owner');
    tracker.report(app, false);
    tracker.report(laptop, false);
    expect(told).toEqual(['app:nowhere', 'laptop:nowhere']);

    told.length = 0;
    tracker.report(laptop, true);
    expect(told.sort()).toEqual(['app:elsewhere', 'laptop:here']);

    told.length = 0;
    time.advance(1_000);
    tracker.report(app, true);
    expect(told.sort()).toEqual(['app:here', 'laptop:elsewhere']);

    told.length = 0;
    tracker.report(app, true);
    expect(told).toEqual([]);
  });

  test('tells every page you are nowhere once the last page you used has been idle for the window', () => {
    const { tracker, told, time } = createTracker();
    const app = createPage('app', 'local');
    const phone = createPage('phone', 'owner');
    tracker.report(phone, false);
    tracker.report(app, true);
    told.length = 0;

    time.advance(ATTENTION_IDLE_MS - 1);
    expect(told).toEqual([]);
    time.advance(1);
    expect(told.sort()).toEqual(['app:nowhere', 'phone:nowhere']);
    expect(time.pending()).toBe(0);
  });

  test('hands the attention to the page used before when the one you used last closes', () => {
    const { tracker, told, time } = createTracker();
    const app = createPage('app', 'local');
    const laptop = createPage('laptop', 'owner');
    tracker.report(app, true);
    time.advance(10);
    tracker.report(laptop, true);
    told.length = 0;

    tracker.remove(laptop);
    expect(told).toEqual(['app:here']);

    told.length = 0;
    tracker.remove(app);
    tracker.remove(createPage('never-reported', 'local'));
    expect(told).toEqual([]);
    expect(time.pending()).toBe(0);
  });

  test('a member never takes the owner’s attention and always hears nowhere, and a guest is not tracked', () => {
    const { tracker, told } = createTracker();
    const app = createPage('app', 'local');
    const member = createPage('member', 'remote');
    const guest = createPage('guest', 'remote', {
      id: 'u-kai',
      login: 'kai',
      name: null,
      avatarUrl: null,
      scope: { kind: 'task', taskId: 't-1' },
    });
    tracker.report(app, true);
    tracker.report(member, true);
    tracker.report(guest, true);
    expect(told).toEqual(['app:here', 'member:nowhere']);
  });

  test('stops its idle timer when the hub stops', () => {
    const { tracker, time } = createTracker();
    tracker.report(createPage('app', 'local'), true);
    expect(time.pending()).toBe(1);
    tracker.stop();
    expect(time.pending()).toBe(0);
    tracker.stop();
  });

  test('keeps a timer of its own when given no clock', () => {
    const told: string[] = [];
    const tracker = new AttentionTracker<Page>((page, where) => told.push(`${page.name}:${where}`));
    tracker.report(createPage('app', 'local'), true);
    expect(told).toEqual(['app:here']);
    tracker.stop();
  });
});
