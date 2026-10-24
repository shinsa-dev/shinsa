import { describe, expect, setSystemTime, test } from 'bun:test';
import { join } from 'node:path';
import { ConfigStore } from '../../src/config/index.ts';
import { type Discoverer, Roots } from '../../src/repos/index.ts';
import { createTempDir } from '../helpers/index.ts';

function createRoots(fromEnvironment: string[] = []) {
  const store = new ConfigStore(join(createTempDir(), 'config.json'));
  let calls = 0;
  const discover: Discoverer = (home) => {
    calls += 1;
    return Promise.resolve({
      candidates: [{ path: join(home, 'Developer'), repoCount: 2, repos: ['a', 'b'] }],
      truncated: false,
    });
  };
  const roots = new Roots(fromEnvironment, store, '/home/me', discover);
  return { roots, store, calls: () => calls };
}

describe('Roots', () => {
  test('without chosen folders it falls back to discovery, once per period', async () => {
    const { roots, calls } = createRoots();
    expect(roots.resolveKind()).toBe('discovered');
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
    const { roots, store, calls } = createRoots(['/env']);
    expect(roots.resolveKind()).toBe('environment');
    expect(await roots.listRoots()).toEqual(['/env']);
    store.update({ roots: ['/code', '/env'] });
    expect(roots.resolveKind()).toBe('configured');
    expect(await roots.listRoots()).toEqual(['/env', '/code']);
    expect(roots.configured).toEqual(['/code', '/env']);
    expect(roots.fromEnvironment).toEqual(['/env']);
    expect(calls()).toBe(0);
  });
});
