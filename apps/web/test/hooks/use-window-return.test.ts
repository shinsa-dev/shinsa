import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import { useWindowReturn } from '@/hooks/use-window-return.ts';

let restores: (() => void)[] = [];

afterEach(() => {
  for (const restore of restores) restore();
  restores = [];
});

function showWindow(state: 'visible' | 'hidden', focused: boolean) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  const focus = spyOn(document, 'hasFocus').mockReturnValue(focused);
  restores.push(
    () => Reflect.deleteProperty(document, 'visibilityState'),
    () => focus.mockRestore()
  );
}

describe('useWindowReturn', () => {
  it('runs once each time you come back to the window, not while you stay', () => {
    showWindow('visible', true);
    let returns = 0;
    renderHook(() => useWindowReturn(() => (returns += 1), true));
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(returns).toBe(0);
    act(() => {
      window.dispatchEvent(new Event('blur'));
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('focus'));
    });
    expect(returns).toBe(1);
  });

  it('counts a hidden window shown again, and waits while it is still hidden', () => {
    for (const restore of restores) restore();
    restores = [];
    showWindow('hidden', false);
    let returns = 0;
    renderHook(() => useWindowReturn(() => (returns += 1), true));
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(returns).toBe(0);
    for (const restore of restores) restore();
    restores = [];
    showWindow('visible', true);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(returns).toBe(1);
  });

  it('does nothing while it is off, and stops listening when it turns off', () => {
    showWindow('visible', false);
    let returns = 0;
    const { rerender } = renderHook(({ active }) => useWindowReturn(() => (returns += 1), active), {
      initialProps: { active: false },
    });
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(returns).toBe(0);
    rerender({ active: true });
    rerender({ active: false });
    act(() => {
      window.dispatchEvent(new Event('blur'));
      window.dispatchEvent(new Event('focus'));
    });
    expect(returns).toBe(0);
  });
});
