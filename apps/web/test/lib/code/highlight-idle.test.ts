import { afterEach, describe, expect, it, mock } from 'bun:test';
import { renderHook, waitFor } from '@testing-library/react';
import { useLanguageTokens } from '@/lib/code/highlight.ts';

const original = {
  requestIdleCallback: globalThis.requestIdleCallback,
  cancelIdleCallback: globalThis.cancelIdleCallback,
};

afterEach(() => {
  globalThis.requestIdleCallback = original.requestIdleCallback;
  globalThis.cancelIdleCallback = original.cancelIdleCallback;
});

describe('useLanguageTokens off the busy path', () => {
  it('highlights when the page is idle, and reads a highlighted block at once the next time', async () => {
    const cancelled = mock(() => {});
    globalThis.requestIdleCallback = ((work: () => void) =>
      setTimeout(work)) as unknown as typeof requestIdleCallback;
    globalThis.cancelIdleCallback = cancelled as unknown as typeof cancelIdleCallback;
    const first = renderHook(() => useLanguageTokens('const idle = 1;', 'typescript'));
    expect(first.result.current).toBeNull();
    await waitFor(() => expect(first.result.current).not.toBeNull());
    first.unmount();
    expect(cancelled).toHaveBeenCalled();
    const again = renderHook(() => useLanguageTokens('const idle = 1;', 'typescript'));
    expect(again.result.current?.[0]?.length).toBeGreaterThan(0);
  });
});
