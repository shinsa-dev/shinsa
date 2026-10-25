import { describe, expect, it } from 'bun:test';
import { renderHook, waitFor } from '@testing-library/react';
import { useProgressiveCount } from '@/hooks/use-progressive-count.ts';

describe('useProgressiveCount', () => {
  it('shows the first rows at once and the rest a batch at a time after', async () => {
    const { result, rerender } = renderHook(({ total }) => useProgressiveCount(total, 20), {
      initialProps: { total: 50 },
    });
    expect(result.current).toBe(20);
    await waitFor(() => expect(result.current).toBe(50));
    rerender({ total: 10 });
    expect(result.current).toBe(10);
  });
});
