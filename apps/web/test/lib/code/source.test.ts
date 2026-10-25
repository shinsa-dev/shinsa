import { describe, expect, it } from 'bun:test';
import type { DiffFile, TaskDiff } from '@shinsa/core';
import { hasOneSide, resolveFileSource } from '@/lib/code/source.ts';

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

describe('resolveFileSource', () => {
  it('reads each side of a diff from where the file lives at that commit', () => {
    const source = (path: string) => resolveFileSource({ kind: 'diff', path }, DIFF);
    expect(source('added.ts')).toMatchObject({ headPath: 'added.ts', basePath: null });
    expect(source('gone.ts')).toMatchObject({ headPath: null, basePath: 'gone.ts' });
    expect(source('new.ts')).toMatchObject({ headPath: 'new.ts', basePath: 'old.ts' });
    expect(source('same.ts')).toMatchObject({ headPath: 'same.ts', basePath: 'same.ts' });
  });

  it('shows a file, or a diff of a file the change did not touch, as the file alone', () => {
    expect(resolveFileSource({ kind: 'diff', path: 'other.ts' }, DIFF)).toMatchObject({
      headPath: 'other.ts',
      basePath: null,
      change: null,
    });
    expect(resolveFileSource({ kind: 'file', path: 'same.ts' }, DIFF)).toMatchObject({
      basePath: null,
      change: null,
    });
    expect(resolveFileSource({ kind: 'diff', path: 'same.ts' }, null).change).toBeNull();
  });
});

describe('hasOneSide', () => {
  it('is true for a whole file added or deleted, and false for a change on both sides or no diff', () => {
    const open = (path: string, kind: 'diff' | 'file' = 'diff') => resolveFileSource({ kind, path }, DIFF);
    expect(hasOneSide(open('added.ts'))).toBe(true);
    expect(hasOneSide(open('gone.ts'))).toBe(true);
    expect(hasOneSide(open('new.ts'))).toBe(false);
    expect(hasOneSide(open('same.ts'))).toBe(false);
    expect(hasOneSide(open('same.ts', 'file'))).toBe(false);
  });
});
