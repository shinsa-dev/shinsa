import { describe, expect, test } from 'bun:test';
import { realpathSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { resolveInside } from '../../src/http/paths.ts';
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
