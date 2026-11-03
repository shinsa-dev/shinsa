import { describe, expect, test } from 'bun:test';
import { Duration, Effect, Scope } from 'effect';
import { IDLE_RELEASE_MS, type IdleReleaseOptions, MAX_IDLE_PIN_MS } from '../../src/agents/idle/schema.ts';
import { makeIdleRelease } from '../../src/agents/idle/service.ts';
import type { AgentSession } from '../../src/agents/providers/index.ts';
import { until } from '../helpers/index.ts';

function createSession(background: () => boolean = () => false) {
  let checks = 0;
  const session: AgentSession = {
    done: Promise.resolve({ outcome: 'completed', summary: null }),
    steer: () => true,
    cancel: () => Promise.resolve(),
    hasPendingBackgroundWork: () => {
      checks += 1;
      return background();
    },
  };
  return { session, checks: () => checks };
}

function track({ idleMs = 5, maxPinMs = MAX_IDLE_PIN_MS, now = Date.now }: IdleReleaseOptions = {}) {
  const released: string[] = [];
  const handle = Effect.runSync(
    makeIdleRelease({
      release: (runId) => Effect.sync(() => released.push(runId)),
      idle: Duration.millis(idleMs),
      maxPinMs,
      now: Effect.sync(now),
    }).pipe(Scope.provide(Effect.runSync(Scope.make())))
  );
  const idle = {
    wait: (runId: string, session: AgentSession) => {
      const end = Effect.runSync(handle.wait(runId, session));
      return () => Effect.runSync(end);
    },
    isWaiting: (runId: string, session: AgentSession) => Effect.runSync(handle.isWaiting(runId, session)),
    touch: (runId: string) => Effect.runSync(handle.touch(runId)),
    forget: (runId: string) => Effect.runSync(handle.forget(runId)),
  };
  return { idle, released };
}

describe('releasing an idle session', () => {
  test('waits 30 minutes by default and pins background work for up to 4 hours', () => {
    expect(IDLE_RELEASE_MS).toBe(30 * 60_000);
    expect(MAX_IDLE_PIN_MS).toBe(4 * 60 * 60_000);
  });

  test('a session that waits on an answer without activity is released once', async () => {
    const { idle, released } = track();
    const { session } = createSession();
    idle.wait('run-1', session);
    await until('the release', () => released.length === 1);
    expect(released).toEqual(['run-1']);
  });

  test('an answer before the timeout ends the wait, and two waits end only with the second', async () => {
    const { idle, released } = track();
    const { session } = createSession();
    const answered = idle.wait('run-1', session);
    answered();
    idle.touch('run-1');
    const first = idle.wait('run-2', session);
    const second = idle.wait('run-2', session);
    first();
    first();
    await until('the release', () => released.length === 1);
    expect(released).toEqual(['run-2']);
    second();
  });

  test('pending background work keeps it pinned until the pin runs out, and activity restarts the pin', async () => {
    let now = 0;
    const { idle, released } = track({ maxPinMs: 1_000, now: () => now });
    const work = createSession(() => true);
    idle.wait('run-1', work.session);
    await until('three checks', () => work.checks() >= 3);
    expect(released).toEqual([]);
    now = 900;
    idle.touch('run-1');
    now = 1_500;
    const before = work.checks();
    await until('a check after the touch', () => work.checks() > before + 1);
    expect(released).toEqual([]);
    now = 3_000;
    await until('the release', () => released.length === 1);
  });

  test('a newer session replaces the older one, and a forgotten run is never released', async () => {
    const { idle, released } = track({ idleMs: 20 });
    const old = createSession();
    const newer = createSession();
    const endOld = idle.wait('run-1', old.session);
    idle.wait('run-1', newer.session);
    endOld();
    idle.wait('run-2', createSession().session);
    idle.forget('run-2');
    idle.forget('run-2');
    idle.wait('run-3', createSession().session);
    await until('both releases', () => released.length === 2);
    expect([...released].sort()).toEqual(['run-1', 'run-3']);
  });

  test('a session that cannot say whether work is pending is released, and stops waiting', async () => {
    const { idle, released } = track();
    const session: AgentSession = {
      done: Promise.resolve({ outcome: 'completed', summary: null }),
      steer: () => true,
      cancel: () => Promise.resolve(),
    };
    idle.wait('run-1', session);
    expect(idle.isWaiting('run-1', session)).toBe(true);
    await until('the release', () => released.length === 1);
    expect(idle.isWaiting('run-1', session)).toBe(false);
  });
});
