import { describe, expect, setSystemTime, test } from 'bun:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import type { Discoverer } from '../../src/repos/index.ts';
import { createConfigAt } from '../helpers/config.ts';
import { Engine } from '../helpers/engine.ts';
import { openEventLog } from '../helpers/event-log.ts';
import { createTempDir } from '../helpers/index.ts';
import { createTestMachine } from '../helpers/machine.ts';

function openRoots(fromEnvironment: string[], userHome: string, discover?: Discoverer | null) {
  const config = createConfigAt(createTempDir(), { roots: fromEnvironment, userHome });
  const { roots, store } = createTestMachine(new Engine(openEventLog()), config, { discover });
  return {
    kind: () => Effect.runSync(roots.kind),
    listRoots: () => Effect.runPromise(roots.listRoots),
    discover: (force = false) => Effect.runPromise(roots.discover(force)),
    configured: () => Effect.runSync(roots.configured),
    fromEnvironment: roots.fromEnvironment,
    update: (configured: string[]) => Effect.runSync(store.update({ roots: configured })),
  };
}

function createRoots(fromEnvironment: string[] = []) {
  let calls = 0;
  const discover: Discoverer = (home) => {
    calls += 1;
    return Promise.resolve({
      candidates: [{ path: join(home, 'Developer'), repoCount: 2, repos: ['a', 'b'] }],
      truncated: false,
      refused: [],
    });
  };
  return { roots: openRoots(fromEnvironment, '/home/me', discover), calls: () => calls };
}

describe('Roots', () => {
  test('without chosen folders it falls back to discovery, once per period', async () => {
    const { roots, calls } = createRoots();
    expect(roots.kind()).toBe('discovered');
    expect(await roots.listRoots()).toEqual(['/home/me/Developer']);
    await roots.listRoots();
    expect(calls()).toBe(1);
    await roots.discover(true);
    expect(calls()).toBe(2);
  });

  test('discovery runs again once its result is ten minutes old', async () => {
    const { roots, calls } = createRoots();
    const start = Date.now();
    try {
      setSystemTime(start);
      await roots.discover();
      setSystemTime(start + 10 * 60 * 1000);
      await roots.discover();
      expect(calls()).toBe(1);
      setSystemTime(start + 10 * 60 * 1000 + 1);
      await roots.discover();
      expect(calls()).toBe(2);
    } finally {
      setSystemTime();
    }
  });

  test('chosen folders and SHINSA_ROOTS replace discovery, chosen ones first in the kind', async () => {
    const { roots, calls } = createRoots(['/env']);
    expect(roots.kind()).toBe('environment');
    expect(await roots.listRoots()).toEqual(['/env']);
    roots.update(['/code', '/env']);
    expect(roots.kind()).toBe('configured');
    expect(await roots.listRoots()).toEqual(['/env', '/code']);
    expect(roots.configured()).toEqual(['/code', '/env']);
    expect(roots.fromEnvironment).toEqual(['/env']);
    expect(calls()).toBe(0);
  });

  test('without a discoverer of its own it looks through the home folder', async () => {
    const home = createTempDir();
    mkdirSync(join(home, 'Developer', 'app', '.git'), { recursive: true });
    expect(await openRoots([], home, null).listRoots()).toEqual([join(home, 'Developer')]);
  });
});
