import { describe, expect, it } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import { useOutbox } from '@/hooks/use-outbox.ts';
import { listOutboxMessages, sendThroughOutbox } from '@/lib/tasks/outbox.ts';

describe('the outbox', () => {
  it('holds a message for its task while it is sent and lets it go once the server answers, either way', async () => {
    let answer: (value: boolean) => void = () => undefined;
    const sending = sendThroughOutbox('t', 'Use tabs', () => {
      return new Promise<boolean>((resolve) => {
        answer = resolve;
      });
    });
    expect(listOutboxMessages('t')).toMatchObject([{ text: 'Use tabs' }]);
    expect(listOutboxMessages('t')).toBe(listOutboxMessages('t'));
    expect(listOutboxMessages('other')).toEqual([]);
    answer(true);
    expect(await sending).toBe(true);
    expect(listOutboxMessages('t')).toEqual([]);

    const failing = sendThroughOutbox('t', 'Oops', () => Promise.reject(new Error('offline')));
    await expect(failing).rejects.toThrow('offline');
    expect(listOutboxMessages('t')).toEqual([]);
  });

  it('re-renders the chat when a message enters or leaves the outbox', async () => {
    const { result, unmount } = renderHook(() => useOutbox('t'));
    expect(result.current).toEqual([]);
    let answer: () => void = () => undefined;
    let sending: Promise<void> = Promise.resolve();
    act(() => {
      sending = sendThroughOutbox('t', 'Hello', () => {
        return new Promise<void>((resolve) => {
          answer = resolve;
        });
      });
    });
    expect(result.current.map((message) => message.text)).toEqual(['Hello']);
    await act(async () => {
      answer();
      await sending;
    });
    expect(result.current).toEqual([]);
    unmount();
  });
});
