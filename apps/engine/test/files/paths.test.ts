import { describe, expect, test } from 'bun:test';
import { realpathSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { isFolder, isInside, resolveInside } from '../../src/files/paths.ts';
import { createTempDir, writeFiles } from '../helpers/index.ts';

describe('resolveInside', () => {
  test('resolves files under the root, including ones not written yet', () => {
    const root = createTempDir();
    writeFiles(root, { 'src/a.ts': '' });
    const real = realpathSync(root);
    expect(resolveInside(root, 'src/a.ts')).toBe(join(real, 'src/a.ts'));
    expect(resolveInside(root, 'src/new.ts')).toBe(join(real, 'src/new.ts'));
  });

  test('refuses the root itself, parent paths, absolute paths elsewhere and symlinks that leave', () => {
    const root = createTempDir();
    const outside = createTempDir();
    writeFiles(outside, { 'secret.txt': 'x' });
    symlinkSync(join(outside, 'secret.txt'), join(root, 'link.txt'));
    for (const path of ['', '.', '../x', '/etc/passwd', 'link.txt'])
      expect(resolveInside(root, path)).toBeNull();
    expect(resolveInside(join(root, 'missing'), 'a')).toBeNull();
  });
});

describe('isInside', () => {
  test('holds the folder itself and what is under it, with or without a trailing slash', () => {
    for (const root of ['/work/repo', '/work/repo/', '/work/repo//']) {
      expect(isInside(root, '/work/repo')).toBe(true);
      expect(isInside(root, '/work/repo/src/a.ts')).toBe(true);
    }
    expect(isInside('/work/repo/', '/work/repo/')).toBe(true);
  });

  test('refuses a sibling that only shares the prefix, and the folder above', () => {
    expect(isInside('/work/repo', '/work/repository')).toBe(false);
    expect(isInside('/work/repo', '/work')).toBe(false);
    expect(isInside('/work/repo/', '/work/repo-old/a')).toBe(false);
  });
});

describe('isFolder', () => {
  test('holds a folder, never a file or a path that is not there', () => {
    const root = createTempDir();
    writeFiles(root, { 'a.txt': 'a' });
    expect(isFolder(root)).toBe(true);
    expect(isFolder(join(root, 'a.txt'))).toBe(false);
    expect(isFolder(join(root, 'missing'))).toBe(false);
  });
});
