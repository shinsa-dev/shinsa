import { describe, expect, it } from 'bun:test';
import type { DiffFile } from '@shinsa/core';
import { FILE_STATUS, listFileGroups, sumChanges } from '@/lib/code/file-groups.ts';

function createFile(path: string, additions = 1, deletions = 0): DiffFile {
  return {
    path,
    previousPath: null,
    status: 'modified',
    additions,
    deletions,
    risk: 'normal',
    riskReason: null,
    patch: '',
  };
}

describe('listFileGroups', () => {
  it('groups files by their directory, sorted by path', () => {
    const groups = listFileGroups([
      createFile('src/b.ts'),
      createFile('README.md'),
      createFile('src/a.ts'),
      createFile('src/lib/c.ts'),
    ]);
    expect(groups.map((group) => [group.directory, group.files.map((file) => file.path)])).toEqual([
      ['', ['README.md']],
      ['src', ['src/a.ts', 'src/b.ts']],
      ['src/lib', ['src/lib/c.ts']],
    ]);
  });

  it('orders the groups by directory name, whatever the file names', () => {
    const groups = listFileGroups([createFile('src/z.ts'), createFile('src/a/b.ts')]);
    expect(groups.map((group) => group.directory)).toEqual(['src', 'src/a']);
  });

  it('leaves the files it was given in their original order', () => {
    const files = [createFile('b.ts'), createFile('a.ts')];
    listFileGroups(files);
    expect(files.map((file) => file.path)).toEqual(['b.ts', 'a.ts']);
  });

  it('returns no groups for no files', () => {
    expect(listFileGroups([])).toEqual([]);
  });
});

describe('sumChanges', () => {
  it('adds up the lines added and removed across files', () => {
    expect(sumChanges([createFile('a.ts', 12, 3), createFile('b.ts', 4, 0)])).toEqual({
      added: 16,
      removed: 3,
    });
    expect(sumChanges([])).toEqual({ added: 0, removed: 0 });
  });
});

describe('FILE_STATUS', () => {
  it('names each status with its own letter', () => {
    expect(Object.values(FILE_STATUS).map((status) => `${status.letter} ${status.name}`)).toEqual([
      'A Added',
      'D Deleted',
      'M Modified',
      'R Renamed',
    ]);
  });
});
