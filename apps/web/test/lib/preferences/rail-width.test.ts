import { describe, expect, it, mock } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import type * as React from 'react';
import { useRailWidth } from '@/lib/preferences/rail-width.ts';

function pointerDown(clientX: number) {
  return { clientX, preventDefault: mock(() => {}) } as unknown as React.PointerEvent<HTMLElement>;
}

function moveTo(clientX: number) {
  dispatchEvent(new PointerEvent('pointermove', { clientX }));
}

describe('useRailWidth', () => {
  it('starts at 240px', () => {
    expect(renderHook(() => useRailWidth()).result.current.width).toBe(240);
  });

  it('reads a stored width and clamps it to the allowed range', () => {
    localStorage.setItem('shinsa.rail-width', '300.6');
    expect(renderHook(() => useRailWidth()).result.current.width).toBe(301);
    localStorage.setItem('shinsa.rail-width', '9000');
    expect(renderHook(() => useRailWidth()).result.current.width).toBe(420);
    localStorage.setItem('shinsa.rail-width', '50');
    expect(renderHook(() => useRailWidth()).result.current.width).toBe(200);
  });

  it('ignores a stored width that is not a positive number', () => {
    for (const stored of ['wide', '-10', '0', 'Infinity']) {
      localStorage.setItem('shinsa.rail-width', stored);
      expect(renderHook(() => useRailWidth()).result.current.width).toBe(240);
    }
  });

  it('resizes while dragging and stores the final width on release', () => {
    const { result } = renderHook(() => useRailWidth());
    const down = pointerDown(100);
    act(() => result.current.startResize(down));
    expect(down.preventDefault).toHaveBeenCalled();
    expect(document.body.style.cursor).toBe('col-resize');
    expect(document.body.dataset.dragging).toBe('');
    act(() => moveTo(150));
    expect(result.current.width).toBe(290);
    expect(localStorage.getItem('shinsa.rail-width')).toBeNull();
    act(() => moveTo(1000));
    expect(result.current.width).toBe(420);
    act(() => {
      dispatchEvent(new PointerEvent('pointerup'));
    });
    expect(localStorage.getItem('shinsa.rail-width')).toBe('420');
    expect(document.body.style.cursor).toBe('');
    expect(document.body.dataset.dragging).toBeUndefined();
    act(() => moveTo(0));
    expect(result.current.width).toBe(420);
  });

  it('stores the width when the drag is cancelled', () => {
    const { result } = renderHook(() => useRailWidth());
    act(() => result.current.startResize(pointerDown(300)));
    act(() => moveTo(250));
    act(() => {
      dispatchEvent(new PointerEvent('pointercancel'));
    });
    expect(localStorage.getItem('shinsa.rail-width')).toBe('200');
  });

  it('ends a drag that is still running when the rail unmounts', () => {
    const { result, unmount } = renderHook(() => useRailWidth());
    act(() => result.current.startResize(pointerDown(100)));
    act(() => moveTo(130));
    unmount();
    expect(document.body.style.cursor).toBe('');
    expect(localStorage.getItem('shinsa.rail-width')).toBe('270');
  });

  it('ends the previous drag before starting another', () => {
    const { result } = renderHook(() => useRailWidth());
    act(() => result.current.startResize(pointerDown(100)));
    act(() => moveTo(110));
    act(() => result.current.startResize(pointerDown(110)));
    expect(localStorage.getItem('shinsa.rail-width')).toBe('250');
    act(() => {
      dispatchEvent(new PointerEvent('pointerup'));
    });
  });

  it('resets to the default width and forgets the stored one', () => {
    localStorage.setItem('shinsa.rail-width', '360');
    const { result } = renderHook(() => useRailWidth());
    act(() => result.current.resetWidth());
    expect(result.current.width).toBe(240);
    expect(localStorage.getItem('shinsa.rail-width')).toBeNull();
  });
});
