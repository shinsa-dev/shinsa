import { describe, expect, it } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import { SETTLE_MS, useSettling } from '@/hooks/use-settling.ts';

function wait(ms: number) {
  return act(() => new Promise((resolve) => setTimeout(resolve, ms)));
}

describe('useSettling', () => {
  it('settles over 400ms by default', () => {
    expect(SETTLE_MS).toBe(400);
  });

  it('is active while active, settles for the delay after it ends, then is done', async () => {
    const { result, rerender } = renderHook(({ active }) => useSettling(active, 20), {
      initialProps: { active: true },
    });
    expect(result.current).toBe('active');
    rerender({ active: false });
    expect(result.current).toBe('settling');
    await wait(40);
    expect(result.current).toBeNull();
  });

  it('never settles what was never active, and turns active again at once', async () => {
    const { result, rerender } = renderHook(({ active }) => useSettling(active, 40), {
      initialProps: { active: false },
    });
    expect(result.current).toBeNull();
    rerender({ active: true });
    expect(result.current).toBe('active');
    rerender({ active: false });
    await wait(10);
    rerender({ active: true });
    expect(result.current).toBe('active');
    await wait(50);
    expect(result.current).toBe('active');
  });
});
