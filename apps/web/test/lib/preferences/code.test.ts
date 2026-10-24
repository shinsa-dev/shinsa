import { describe, expect, it } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import {
  readViewedFiles,
  toggleViewedFile,
  useExplorerWidth,
  useHideViewed,
  useSplitDiff,
  useViewedFiles,
} from '@/lib/preferences/code.ts';

describe('code preferences', () => {
  it('remembers the diff layout', () => {
    const { result } = renderHook(() => useSplitDiff());
    expect(result.current[0]).toBe(false);
    act(() => result.current[1]());
    expect(result.current[0]).toBe(true);
    expect(localStorage.getItem('shinsa.code-split')).toBe('true');
  });

  it('remembers whether viewed files are hidden', () => {
    const { result } = renderHook(() => useHideViewed());
    expect(result.current[0]).toBe(false);
    act(() => result.current[1]());
    expect(result.current[0]).toBe(true);
    expect(localStorage.getItem('shinsa.code-hide-viewed')).toBe('true');
  });

  it('starts the file list at its default width', () => {
    expect(renderHook(() => useExplorerWidth()).result.current.width).toBe(280);
  });

  it('marks files viewed per task and head, and unmarks them', () => {
    const { result } = renderHook(() => useViewedFiles('t1', 'h1'));
    expect([...result.current]).toEqual([]);
    act(() => toggleViewedFile('t1', 'h1', 'a.ts'));
    expect([...result.current]).toEqual(['a.ts']);
    expect(readViewedFiles('t1', 'h2')).toEqual([]);
    act(() => toggleViewedFile('t1', 'h1', 'a.ts'));
    expect([...result.current]).toEqual([]);
    expect([...renderHook(() => useViewedFiles('t1', null)).result.current]).toEqual([]);
  });

  it('reads a damaged mark list as nothing viewed', () => {
    localStorage.setItem('shinsa.viewed.t1.h1', '{broken');
    expect(readViewedFiles('t1', 'h1')).toEqual([]);
    localStorage.setItem('shinsa.viewed.t1.h1', JSON.stringify(['a.ts', 3]));
    expect(readViewedFiles('t1', 'h1')).toEqual(['a.ts']);
    localStorage.setItem('shinsa.viewed.t1.h1', '{"a":1}');
    expect(readViewedFiles('t1', 'h1')).toEqual([]);
  });
});
