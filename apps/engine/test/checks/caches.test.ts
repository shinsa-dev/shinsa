import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pruneSharedCaches, resolveRepoCachePath, resolveSharedCacheEnv } from '../../src/checks/caches.ts';
import { createTempDir, writeFiles } from '../helpers/index.ts';

describe('the caches a repository’s checkouts share', () => {
  test('a Turbo repository gets one Turbo cache per repository, in Shinsa’s data folder', () => {
    const checkout = createTempDir();
    writeFiles(checkout, { 'turbo.json': '{}' });
    expect(resolveSharedCacheEnv(checkout, '/data', 'repo-1')).toEqual({
      TURBO_CACHE_DIR: join('/data', 'caches', 'repo-1', 'turbo'),
    });
    expect(resolveRepoCachePath('/data', 'repo-1')).toBe(join('/data', 'caches', 'repo-1'));
  });

  test('a repository without Turbo gets no variables', () => {
    expect(resolveSharedCacheEnv(createTempDir(), '/data', 'repo-1')).toEqual({});
  });

  test('pruning drops what has not been written in two weeks and the caches of repositories Shinsa forgot', () => {
    const dataDir = createTempDir();
    const turbo = join(dataDir, 'caches', 'repo-1', 'turbo');
    mkdirSync(turbo, { recursive: true });
    mkdirSync(join(dataDir, 'caches', 'repo-gone', 'turbo'), { recursive: true });
    for (const name of ['fresh.tar.zst', 'stale.tar.zst', '.marker']) writeFileSync(join(turbo, name), '');
    const now = Date.now();
    const old = new Date(now - 15 * 24 * 60 * 60 * 1000);
    utimesSync(join(turbo, 'stale.tar.zst'), old, old);
    utimesSync(join(turbo, '.marker'), old, old);
    pruneSharedCaches(dataDir, ['repo-1'], now);
    expect(existsSync(join(turbo, 'fresh.tar.zst'))).toBe(true);
    expect(existsSync(join(turbo, 'stale.tar.zst'))).toBe(false);
    expect(existsSync(join(turbo, '.marker'))).toBe(true);
    expect(existsSync(join(dataDir, 'caches', 'repo-gone'))).toBe(false);
    pruneSharedCaches(createTempDir(), [], now);
  });
});
