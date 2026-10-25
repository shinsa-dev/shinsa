import { describe, expect, it } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import {
  readViewedFiles,
  toggleViewedFile,
  useExplorerWidth,
  useHideViewed,
  useUnifiedDiff,
  useViewedFiles,
} from '@/lib/preferences/code.ts';

describe('code preferences', () => {
  it('shows diffs side by side until you pick unified, and remembers it', () => {
    const { result } = renderHook(() => useUnifiedDiff());
    expect(result.current[0]).toBe(false);
    act(() => result.current[1]());
    expect(result.current[0]).toBe(true);
    expect(localStorage.getItem('shinsa.code-unified')).toBe('true');
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

  it('never makes the file list narrower than its header needs, up to the widest it may be', () => {
    localStorage.setItem('shinsa.code-explorer-width', '200');
    const { result, rerender } = renderHook(({ floor }) => useExplorerWidth(floor), {
      initialProps: { floor: 236.2 },
    });
    expect(result.current.width).toBe(237);
    rerender({ floor: 900 });
    expect(result.current.width).toBe(480);
    rerender({ floor: 150 });
    expect(result.current.width).toBe(200);
    localStorage.removeItem('shinsa.code-explorer-width');
    rerender({ floor: 300 });
    act(() => result.current.resetWidth());
    expect(result.current.width).toBe(300);
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
