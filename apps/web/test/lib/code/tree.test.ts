import { describe, expect, it } from 'bun:test';
import type { DiffFile } from '@shinsa/core';
import {
  FILE_STATUS,
  findActiveGuide,
  listAncestors,
  listChangeRows,
  listShownChanges,
  pickGuideLevel,
  resolveActiveGuide,
  resolveDirectory,
  resolveFileName,
  sumChanges,
} from '@/lib/code/tree.ts';

function file(path: string, overrides: Partial<DiffFile> = {}): DiffFile {
  return {
    path,
    previousPath: null,
    status: 'modified',
    additions: 1,
    deletions: 2,
    risk: 'normal',
    riskReason: null,
    binary: false,
    patch: '',
    ...overrides,
  };
}

const FILES = [
  file('README.md'),
  file('apps/web/src/a.ts'),
  file('apps/web/src/b.ts'),
  file('apps/web/test/a.test.ts'),
];

describe('listChangeRows', () => {
  it('nests folders first, folds a chain of single folders into one row, and lists files by name', () => {
    expect(listChangeRows(FILES, new Set()).map((row) => `${'  '.repeat(row.depth)}${row.name}`)).toEqual([
      'apps/web',
      '  src',
      '    a.ts',
      '    b.ts',
      '  test',
      '    a.test.ts',
      'README.md',
    ]);
  });

  it('hides what is inside a collapsed folder', () => {
    const rows = listChangeRows(FILES, new Set(['apps/web/src']));
    expect(rows.map((row) => row.path)).toEqual([
      'apps/web',
      'apps/web/src',
      'apps/web/test',
      'apps/web/test/a.test.ts',
      'README.md',
    ]);
    expect(rows[0]).toMatchObject({ kind: 'directory', file: null });
    expect(rows.at(-1)?.file?.path).toBe('README.md');
  });
});

describe('paths', () => {
  it('names a file, its folder and every folder above it', () => {
    expect(resolveFileName('a/b/c.ts')).toBe('c.ts');
    expect(resolveDirectory('a/b/c.ts')).toBe('a/b');
    expect(resolveDirectory('c.ts')).toBe('');
    expect(listAncestors('a/b/c.ts')).toEqual(['a', 'a/b']);
    expect(listAncestors('c.ts')).toEqual([]);
  });

  it('sums the lines and names each status', () => {
    expect(sumChanges(FILES)).toEqual({ added: 4, removed: 8 });
    expect(Object.values(FILE_STATUS).map((status) => status.letter)).toEqual(['A', 'D', 'M', 'R']);
  });
});

describe('indent guides', () => {
  it('finds the folder row holding the open file in the changes tree', () => {
    const rows = listChangeRows(
      [file('apps/web/src/a.ts'), file('apps/web/src/b.ts'), file('top.ts')],
      new Set()
    );
    expect(findActiveGuide(rows, 'apps/web/src/b.ts')).toEqual({ dir: 'apps/web/src', level: 0 });
    expect(findActiveGuide(rows, 'top.ts')).toBeNull();
    expect(findActiveGuide(rows, 'missing.ts')).toBeNull();
    expect(findActiveGuide(rows, null)).toBeNull();
    expect(
      findActiveGuide([{ kind: 'file', path: 'a/b.ts', name: 'b.ts', depth: 1, file: null }], 'a/b.ts')
    ).toBeNull();
  });

  it("finds the open file's folder in the repository tree", () => {
    expect(resolveActiveGuide('apps/web/src/a.ts')).toEqual({ dir: 'apps/web/src', level: 2 });
    expect(resolveActiveGuide('README.md')).toBeNull();
    expect(resolveActiveGuide(null)).toBeNull();
  });

  it('strengthens the guide only under that folder', () => {
    const guide = { dir: 'apps/web', level: 1 };
    expect(pickGuideLevel(guide, 'apps/web/src')).toBe(1);
    expect(pickGuideLevel(guide, 'apps/web')).toBeUndefined();
    expect(pickGuideLevel(guide, 'apps/webkit/a.ts')).toBeUndefined();
    expect(pickGuideLevel(null, 'apps/web/a.ts')).toBeUndefined();
  });
});

describe('listShownChanges', () => {
  const files = [file('a.ts'), file('b.ts'), file('c.ts')];
  const viewed = new Set(['a.ts', 'b.ts']);

  it('shows every file unless viewed ones are hidden', () => {
    expect(listShownChanges(files, viewed, false, null)).toBe(files);
    expect(listShownChanges(files, viewed, true, null).map((each) => each.path)).toEqual(['c.ts']);
  });

  it('keeps the open file even when it is viewed', () => {
    expect(listShownChanges(files, viewed, true, 'b.ts').map((each) => each.path)).toEqual(['b.ts', 'c.ts']);
  });
});
