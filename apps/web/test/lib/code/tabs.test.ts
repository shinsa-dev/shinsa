import { describe, expect, it } from 'bun:test';
import type { DiffFile, TaskDiff } from '@shinsa/core';
import { listTabLabels, resolveTabSource } from '@/lib/code/tabs.ts';

function file(path: string, status: DiffFile['status'], previousPath: string | null = null): DiffFile {
  return {
    path,
    previousPath,
    status,
    additions: 0,
    deletions: 0,
    risk: 'normal',
    riskReason: null,
    binary: false,
    patch: '',
  };
}

const DIFF: TaskDiff = {
  base: 'b',
  head: 'h',
  files: [
    file('added.ts', 'added'),
    file('gone.ts', 'removed'),
    file('new.ts', 'renamed', 'old.ts'),
    file('same.ts', 'modified'),
  ],
};

describe('resolveTabSource', () => {
  it('reads each side of a diff from where the file lives at that commit', () => {
    const source = (path: string) => resolveTabSource({ kind: 'diff', path }, DIFF);
    expect(source('added.ts')).toMatchObject({ headPath: 'added.ts', basePath: null });
    expect(source('gone.ts')).toMatchObject({ headPath: null, basePath: 'gone.ts' });
    expect(source('new.ts')).toMatchObject({ headPath: 'new.ts', basePath: 'old.ts' });
    expect(source('same.ts')).toMatchObject({ headPath: 'same.ts', basePath: 'same.ts' });
  });

  it('shows a file, or a diff tab of a file the change did not touch, as the file alone', () => {
    expect(resolveTabSource({ kind: 'diff', path: 'other.ts' }, DIFF)).toMatchObject({
      headPath: 'other.ts',
      basePath: null,
      file: null,
    });
    expect(resolveTabSource({ kind: 'file', path: 'same.ts' }, DIFF)).toMatchObject({
      basePath: null,
      file: null,
    });
    expect(resolveTabSource({ kind: 'diff', path: 'same.ts' }, null).file).toBeNull();
  });
});

describe('listTabLabels', () => {
  it('names tabs by file, adding the folder when two share a name', () => {
    expect(
      listTabLabels([
        { kind: 'file', path: 'a/index.ts' },
        { kind: 'diff', path: 'b/index.ts' },
        { kind: 'file', path: 'index.ts' },
        { kind: 'file', path: 'c.ts' },
      ])
    ).toEqual([
      { name: 'index.ts', hint: 'a' },
      { name: 'index.ts', hint: 'b' },
      { name: 'index.ts', hint: null },
      { name: 'c.ts', hint: null },
    ]);
  });
});
