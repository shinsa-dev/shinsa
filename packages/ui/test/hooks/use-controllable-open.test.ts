import { describe, expect, it, mock } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import { useControllableOpen } from '../../src/hooks/use-controllable-open';

describe('useControllableOpen', () => {
  it('owns the state when uncontrolled, starting from defaultOpen', () => {
    const onOpenChange = mock();
    const { result } = renderHook(() => useControllableOpen<string>({ defaultOpen: true, onOpenChange }));
    expect(result.current[0]).toBe(true);

    act(() => result.current[1](false, 'escape'));
    expect(result.current[0]).toBe(false);
    expect(onOpenChange).toHaveBeenCalledWith(false, 'escape');
  });

  it('starts closed without a default and works without a listener', () => {
    const { result } = renderHook(() => useControllableOpen<string>({}));
    expect(result.current[0]).toBe(false);
    act(() => result.current[1](true, 'press'));
    expect(result.current[0]).toBe(true);
  });

  it('only reports changes when controlled, and follows the prop', () => {
    const onOpenChange = mock();
    const { result, rerender } = renderHook(
      ({ open }) => useControllableOpen<string>({ open, onOpenChange }),
      {
        initialProps: { open: false },
      }
    );

    act(() => result.current[1](true, 'press'));
    expect(result.current[0]).toBe(false);
    expect(onOpenChange).toHaveBeenCalledWith(true, 'press');

    rerender({ open: true });
    expect(result.current[0]).toBe(true);
  });
});
