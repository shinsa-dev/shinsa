import { describe, expect, it } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import { LOADING_DELAY_MS, useDelayed } from '@/hooks/use-delayed.ts';

function wait(ms: number) {
  return act(() => new Promise((resolve) => setTimeout(resolve, ms)));
}

describe('useDelayed', () => {
  it('waits 300ms by default', () => {
    expect(LOADING_DELAY_MS).toBe(300);
  });

  it('turns true only once the wait has lasted the delay', async () => {
    const { result, rerender } = renderHook(({ active }) => useDelayed(active, 20), {
      initialProps: { active: true },
    });
    expect(result.current).toBe(false);
    await wait(40);
    expect(result.current).toBe(true);
    rerender({ active: false });
    expect(result.current).toBe(false);
  });

  it('never turns true for a wait shorter than the delay', async () => {
    const { result, rerender } = renderHook(({ active }) => useDelayed(active, 40), {
      initialProps: { active: true },
    });
    await wait(10);
    rerender({ active: false });
    await wait(50);
    expect(result.current).toBe(false);
  });
});
