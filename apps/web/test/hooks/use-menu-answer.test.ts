import { describe, expect, it } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import { useMenuAnswer } from '@/hooks/use-menu-answer.ts';

function createRequests() {
  const pending: ReturnType<typeof Promise.withResolvers<string[]>>[] = [];
  const request = () => {
    const next = Promise.withResolvers<string[]>();
    pending.push(next);
    return next.promise;
  };
  return { pending, request };
}

describe('useMenuAnswer', () => {
  it('asks again each time the menu opens, showing nothing old while it waits', async () => {
    const { pending, request } = createRequests();
    const { result } = renderHook(() => useMenuAnswer(request));
    act(() => result.current.ask(true));
    await act(async () => pending[0]?.resolve(['a']));
    expect(result.current.value).toEqual(['a']);
    act(() => result.current.ask(false));
    expect(pending).toHaveLength(1);
    act(() => result.current.ask(true));
    expect(result.current.value).toBeNull();
    await act(async () => pending[1]?.resolve(['a', 'b']));
    expect(result.current.value).toEqual(['a', 'b']);
  });

  it('ignores slow earlier answers that arrive after a newer one', async () => {
    const { pending, request } = createRequests();
    const { result } = renderHook(() => useMenuAnswer(request));
    act(() => result.current.ask(true));
    act(() => result.current.ask(true));
    act(() => result.current.ask(true));
    await act(async () => pending[2]?.resolve(['new']));
    await act(async () => pending[0]?.resolve(['old']));
    await act(async () => pending[1]?.reject(new Error('late')));
    expect(result.current).toMatchObject({ value: ['new'], failure: null });
  });

  it('says why the list could not be read', async () => {
    const { pending, request } = createRequests();
    const { result } = renderHook(() => useMenuAnswer(request));
    act(() => result.current.ask(true));
    await act(async () => pending[0]?.reject(new Error('The server is offline.')));
    expect(result.current).toMatchObject({ value: null, failure: 'The server is offline.' });
  });
});
