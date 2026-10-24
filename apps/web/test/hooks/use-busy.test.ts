import { describe, expect, it } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import { useBusy } from '@/hooks/use-busy.ts';

describe('useBusy', () => {
  it('is busy with one action while it runs and reports its result', async () => {
    let finish = (_done: boolean) => {};
    const { result } = renderHook(() => useBusy<'retry' | 'cancel'>());
    expect(result.current.busy).toBeNull();
    let ran: Promise<boolean> = Promise.resolve(true);
    act(() => {
      ran = result.current.run(
        'retry',
        () =>
          new Promise<boolean>((resolve) => {
            finish = resolve;
          })
      );
    });
    expect(result.current.busy).toBe('retry');
    await act(async () => {
      finish(false);
      expect(await ran).toBe(false);
    });
    expect(result.current.busy).toBeNull();
  });

  it('is no longer busy after an action that throws, and passes the error on', async () => {
    const { result } = renderHook(() => useBusy<'retry'>());
    await act(async () => {
      await expect(result.current.run('retry', () => Promise.reject(new Error('Offline')))).rejects.toThrow(
        'Offline'
      );
    });
    expect(result.current.busy).toBeNull();
  });
});
