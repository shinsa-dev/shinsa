import { describe, expect, it } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import { useEveryoneQueue, writeEveryoneQueue } from '@/lib/preferences/queue.ts';

describe('useEveryoneQueue', () => {
  it('starts on your own tasks and remembers the choice', () => {
    const { result } = renderHook(() => useEveryoneQueue());
    expect(result.current).toBe(false);
    act(() => writeEveryoneQueue(true));
    expect(result.current).toBe(true);
  });
});
