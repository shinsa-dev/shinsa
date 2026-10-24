import { describe, expect, it } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import { applyLayoutParam, useLayoutPreference, writeLayoutPreference } from '@/lib/preferences/layout.ts';

describe('layout preference', () => {
  it('defaults to cards', () => {
    expect(renderHook(() => useLayoutPreference()).result.current).toBe('cards');
  });

  it('falls back to cards when the stored value is not a layout', () => {
    localStorage.setItem('shinsa.layout', 'grid');
    expect(renderHook(() => useLayoutPreference()).result.current).toBe('cards');
  });

  it('stores the layout and updates readers', () => {
    const { result } = renderHook(() => useLayoutPreference());
    act(() => writeLayoutPreference('sidebar'));
    expect(result.current).toBe('sidebar');
    expect(localStorage.getItem('shinsa.layout')).toBe('sidebar');
  });

  it('takes the layout from the ?layout= param', () => {
    applyLayoutParam('?layout=sidebar');
    expect(localStorage.getItem('shinsa.layout')).toBe('sidebar');
  });

  it('reads the current URL by default', () => {
    history.replaceState(null, '', '/?layout=sidebar');
    applyLayoutParam();
    expect(localStorage.getItem('shinsa.layout')).toBe('sidebar');
  });

  it('ignores a missing or unknown ?layout= param', () => {
    writeLayoutPreference('sidebar');
    applyLayoutParam('?layout=grid');
    applyLayoutParam('');
    expect(localStorage.getItem('shinsa.layout')).toBe('sidebar');
  });
});
