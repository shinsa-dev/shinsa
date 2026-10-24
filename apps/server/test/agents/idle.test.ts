import { describe, expect, spyOn, test } from 'bun:test';
import { IDLE_RELEASE_MS, IdleRelease, MAX_IDLE_PIN_MS } from '../../src/agents/idle.ts';
import type { AgentSession } from '../../src/agents/providers/index.ts';
import { log } from '../../src/log/index.ts';
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

function track(options: ConstructorParameters<typeof IdleRelease>[1] = {}) {
  const released: string[] = [];
  const idle = new IdleRelease(
    (runId) => {
      released.push(runId);
      return Promise.resolve();
    },
    { idleMs: 5, ...options }
  );
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

  test('a session that cannot say whether work is pending is released, and a failed release is logged', async () => {
    const warn = spyOn(log, 'warn').mockImplementation(() => undefined);
    const idle = new IdleRelease(() => Promise.reject(new Error('stuck')), { idleMs: 5 });
    const session: AgentSession = {
      done: Promise.resolve({ outcome: 'completed', summary: null }),
      steer: () => true,
      cancel: () => Promise.resolve(),
    };
    idle.wait('run-1', session);
    await until('the warning', () => warn.mock.calls.length > 0);
    expect(warn).toHaveBeenCalledWith('[Runs] Could not release an idle session', {
      runId: 'run-1',
      error: 'stuck',
    });
    warn.mockRestore();
  });
});
