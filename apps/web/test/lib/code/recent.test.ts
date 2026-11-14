import { describe, expect, it } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import {
  listRecentFiles,
  RECENT_FILE_LIMIT,
  recordRecentFile,
  resolveQuickOpenRecent,
  splitRecentRows,
  useRecentFiles,
} from '@/lib/code/recent.ts';

describe('recent files', () => {
  it('keeps the files opened last first, once each, per task', () => {
    recordRecentFile('t1', 'a.ts');
    recordRecentFile('t1', 'b.ts');
    recordRecentFile('t1', 'a.ts');
    recordRecentFile('t1', 'a.ts');
    recordRecentFile('t2', 'c.ts');
    expect(listRecentFiles('t1')).toEqual(['a.ts', 'b.ts']);
    expect(listRecentFiles('t2')).toEqual(['c.ts']);
    expect(listRecentFiles('t3')).toEqual([]);
  });

  it('keeps only the last ten', () => {
    for (let index = 0; index < RECENT_FILE_LIMIT + 3; index += 1) recordRecentFile('t1', `f${index}.ts`);
    expect(listRecentFiles('t1')).toHaveLength(RECENT_FILE_LIMIT);
    expect(listRecentFiles('t1')[0]).toBe(`f${RECENT_FILE_LIMIT + 2}.ts`);
  });

  it('ignores a stored value that is not a list of paths', () => {
    localStorage.setItem('shinsa.code-recent.t1', '{oops');
    expect(listRecentFiles('t1')).toEqual([]);
  });

  it('leaves the open file out of Go to file’s recent list', () => {
    expect(resolveQuickOpenRecent(['a.ts', 'b.ts'], 'a.ts')).toEqual(['b.ts']);
    expect(resolveQuickOpenRecent(['a.ts'], null)).toEqual(['a.ts']);
  });

  it('splits the recent rows from the rest only while nothing is typed', () => {
    const rows = [{ path: 'a.ts' }, { path: 'b.ts' }, { path: 'c.ts' }];
    expect(splitRecentRows(rows, ['b.ts'], '')).toEqual({
      recentRows: [{ path: 'b.ts' }],
      otherRows: [{ path: 'a.ts' }, { path: 'c.ts' }],
    });
    expect(splitRecentRows(rows, ['b.ts'], 'b')).toEqual({ recentRows: [], otherRows: rows });
    expect(splitRecentRows(rows, [], '')).toEqual({ recentRows: [], otherRows: rows });
  });

  it('renders again when a file is opened', () => {
    const { result } = renderHook(() => useRecentFiles('t1'));
    expect(result.current).toEqual([]);
    act(() => recordRecentFile('t1', 'a.ts'));
    expect(result.current).toEqual(['a.ts']);
  });
});
