import { describe, expect, it } from 'bun:test';
import { renderHook } from '@testing-library/react';
import { useStructuralValue } from '@/hooks/use-structural-value.ts';

describe('useStructuralValue', () => {
  it('keeps the earlier value while a new one has the same shape', () => {
    const first = { items: [{ id: 'a' }] };
    const { result, rerender } = renderHook(({ value }) => useStructuralValue(value), {
      initialProps: { value: first },
    });
    rerender({ value: { items: [{ id: 'a' }] } });
    expect(result.current).toBe(first);
    const changed = { items: [{ id: 'b' }] };
    rerender({ value: changed });
    expect(result.current).toBe(changed);
  });
});
