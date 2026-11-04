import { describe, expect, test } from 'bun:test';
import { mkdirSync, realpathSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { Option } from 'effect';
import { selectInside, selectWritableInside } from '../../src/files/inside.ts';
import { isInside } from '../../src/files/paths.ts';
import { findFirstPresent, isFolder, isPresent, listEntries, selectText } from '../../src/files/probe.ts';
import { runFiles } from '../harness.ts';
import { createTempDir, writeFiles } from '../helpers/index.ts';

const inside = async (root: string, path: string) =>
  Option.getOrNull(await runFiles(selectInside(root, path)));

describe('selectInside', () => {
  test('resolves files under the root, including ones not written yet', async () => {
    const root = createTempDir();
    writeFiles(root, { 'src/a.ts': '' });
    const real = realpathSync(root);
    expect(await inside(root, 'src/a.ts')).toBe(join(real, 'src/a.ts'));
    expect(await inside(root, 'src/new.ts')).toBe(join(real, 'src/new.ts'));
  });

  test('refuses the root itself, parent paths, absolute paths elsewhere and symlinks that leave', async () => {
    const root = createTempDir();
    const outside = createTempDir();
    writeFiles(outside, { 'secret.txt': 'x' });
    symlinkSync(join(outside, 'secret.txt'), join(root, 'link.txt'));
    for (const path of ['', '.', '../x', '/etc/passwd', 'link.txt'])
      expect(await inside(root, path)).toBeNull();
    expect(await inside(join(root, 'missing'), 'a')).toBeNull();
  });
});

describe('selectWritableInside', () => {
  test('takes a new file under folders not made yet, and refuses one under a symlink that leaves', async () => {
    const root = createTempDir();
    const outside = createTempDir();
    const real = realpathSync(root);
    const writable = async (path: string) =>
      Option.getOrNull(await runFiles(selectWritableInside(root, path)));
    expect(await writable('src/deep/new.ts')).toBe(join(real, 'src/deep/new.ts'));
    symlinkSync(outside, join(root, 'away'));
    expect(await writable('away/new/file.ts')).toBeNull();
    expect(await writable('../x')).toBeNull();
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

describe('the file probes', () => {
  test('isFolder holds a folder, never a file or a path that is not there', async () => {
    const root = createTempDir();
    writeFiles(root, { 'a.txt': 'a' });
    expect(await runFiles(isFolder(root))).toBe(true);
    expect(await runFiles(isFolder(join(root, 'a.txt')))).toBe(false);
    expect(await runFiles(isFolder(join(root, 'missing')))).toBe(false);
  });

  test('isPresent and selectText read what is there and answer none for what is not', async () => {
    const root = createTempDir();
    writeFiles(root, { 'a.txt': 'a' });
    expect(await runFiles(isPresent(join(root, 'a.txt')))).toBe(true);
    expect(await runFiles(isPresent(join(root, 'b.txt')))).toBe(false);
    expect(await runFiles(isPresent(join(root, 'a.txt', 'below')))).toBe(false);
    expect(Option.getOrNull(await runFiles(selectText(join(root, 'a.txt'))))).toBe('a');
    expect(Option.isNone(await runFiles(selectText(join(root, 'b.txt'))))).toBe(true);
  });

  test('listEntries sorts a folder’s names and answers nothing for a folder that is not there', async () => {
    const root = createTempDir();
    writeFiles(root, { 'b.txt': '', 'a.txt': '' });
    mkdirSync(join(root, 'c'));
    expect(await runFiles(listEntries(root))).toEqual(['a.txt', 'b.txt', 'c']);
    expect(await runFiles(listEntries(join(root, 'missing')))).toEqual([]);
  });

  test('findFirstPresent picks the first path that is there, in the order given', async () => {
    const root = createTempDir();
    writeFiles(root, { 'b.txt': '', 'c.txt': '' });
    const paths = ['a.txt', 'c.txt', 'b.txt'].map((name) => join(root, name));
    expect(Option.getOrNull(await runFiles(findFirstPresent(paths)))).toBe(join(root, 'c.txt'));
    expect(Option.isNone(await runFiles(findFirstPresent([join(root, 'a.txt')])))).toBe(true);
  });
});
