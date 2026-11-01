import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { resolveRepoCachePath, resolveSharedCacheEnv } from '../../src/checks/caches.ts';
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
});
