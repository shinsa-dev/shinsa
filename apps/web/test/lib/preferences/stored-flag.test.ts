import { describe, expect, it } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import { useStoredFlag, useStoredToggle, writeFlag } from '@/lib/preferences/stored-flag.ts';

describe('useStoredFlag', () => {
  it('falls back until a value is stored', () => {
    expect(renderHook(() => useStoredFlag('shinsa.test', true)).result.current).toBe(true);
    expect(renderHook(() => useStoredFlag('shinsa.test', false)).result.current).toBe(false);
  });

  it('reads a stored value over the fallback', () => {
    localStorage.setItem('shinsa.test', 'false');
    expect(renderHook(() => useStoredFlag('shinsa.test', true)).result.current).toBe(false);
  });

  it('updates every reader when the flag is written', () => {
    const { result } = renderHook(() => useStoredFlag('shinsa.test', false));
    act(() => writeFlag('shinsa.test', true));
    expect(result.current).toBe(true);
    expect(localStorage.getItem('shinsa.test')).toBe('true');
    act(() => writeFlag('shinsa.test', false));
    expect(result.current).toBe(false);
  });
});

describe('useStoredToggle', () => {
  it('starts from the fallback and flips the stored value on each toggle', () => {
    const { result } = renderHook(() => useStoredToggle('shinsa.test', true));
    expect(result.current[0]).toBe(true);
    act(() => result.current[1]());
    expect(result.current[0]).toBe(false);
    expect(localStorage.getItem('shinsa.test')).toBe('false');
    act(() => result.current[1]());
    expect(result.current[0]).toBe(true);
    expect(localStorage.getItem('shinsa.test')).toBe('true');
  });
});
