import { describe, expect, it } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import { useImageViewer } from '@/hooks/use-image-viewer.ts';

describe('useImageViewer', () => {
  it('opens an image by its index and closes it again', () => {
    const { result } = renderHook(() => useImageViewer());
    expect(result.current.index).toBeNull();
    act(() => result.current.show(2));
    expect(result.current.index).toBe(2);
    act(() => result.current.close());
    expect(result.current.index).toBeNull();
  });

  it('remembers each thumbnail so the image can morph out of it and back', () => {
    const { result } = renderHook(() => useImageViewer());
    const thumbnail = document.createElement('img');
    result.current.recordOrigin(1)(thumbnail);
    expect(result.current.resolveOrigin(1)).toBe(thumbnail);
    expect(result.current.resolveOrigin(0)).toBeNull();
    result.current.recordOrigin(1)(null);
    expect(result.current.resolveOrigin(1)).toBeNull();
  });

  it('hands out the same ref callback for an index across renders', () => {
    const { result, rerender } = renderHook(() => useImageViewer());
    const first = result.current.recordOrigin(3);
    rerender();
    expect(result.current.recordOrigin(3)).toBe(first);
    expect(result.current.recordOrigin(4)).not.toBe(first);
  });
});
