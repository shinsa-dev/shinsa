import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useOnboardingChat } from '@/hooks/use-onboarding-chat.ts';
import { spyOnToasts } from '../support/commands.ts';
import {
  createChat,
  createMessage,
  createOnboardingStatus,
  createPrompt,
  startFakeOnboarding,
} from '../support/onboarding.ts';

let fake: ReturnType<typeof startFakeOnboarding> | null = null;

let toasts: ReturnType<typeof spyOnToasts>;

beforeEach(() => {
  toasts = spyOnToasts();
});

afterEach(() => {
  fake?.stop();
  fake = null;
  toasts.restore();
});

describe('useOnboardingChat', () => {
  it('loads the chat, shows the answer while it is read and swaps in the reply', async () => {
    let answer = (_chat: unknown) => {};
    const next = createChat(null, [createMessage({ text: 'Setup is done.' })]);
    fake = startFakeOnboarding({
      'GET /api/onboarding/chat': { answer: createChat(createPrompt()) },
      'POST /api/onboarding/chat': {
        answer: () =>
          new Promise((resolve) => {
            answer = resolve;
          }),
      },
      'GET /api/onboarding': { answer: createOnboardingStatus() },
    });
    const { result } = renderHook(() => useOnboardingChat());
    await waitFor(() => expect(result.current.chat?.prompt?.questionId).toBe('merge'));
    let sent: Promise<boolean> = Promise.resolve(false);
    act(() => {
      sent = result.current.pick({ type: 'choose', questionId: 'merge', values: ['rebase'] }, 'Rebase');
    });
    await waitFor(() => expect(result.current.pending).toBe('Rebase'));
    await act(async () => {
      answer(next);
      expect(await sent).toBe(true);
    });
    expect(result.current.pending).toBeNull();
    expect(result.current.chat).toEqual(next);
  });

  it('shows a refused answer as a toast and leaves the question open', async () => {
    fake = startFakeOnboarding({
      'GET /api/onboarding/chat': { answer: createChat(createPrompt()) },
      'POST /api/onboarding/chat': {
        status: 400,
        answer: { error: { code: 'question_stale', message: 'That question was already answered.' } },
      },
    });
    const { result } = renderHook(() => useOnboardingChat());
    await waitFor(() => expect(result.current.chat).not.toBeNull());
    await act(async () => {
      expect(await result.current.pick({ type: 'choose', questionId: 'merge', values: ['x'] }, 'x')).toBe(
        false
      );
    });
    expect(toasts.error).toHaveBeenCalledWith('That question was already answered.');
    expect(result.current.chat?.prompt?.questionId).toBe('merge');
    expect(result.current.pending).toBeNull();
  });

  it('goes Home instead of opening a setup that is already done', async () => {
    fake = startFakeOnboarding({
      'GET /api/onboarding/chat': { answer: createChat(null, [createMessage({ text: 'Setup is done.' })]) },
    });
    history.replaceState(null, '', '/onboarding');
    const { result } = renderHook(() => useOnboardingChat());
    await waitFor(() => expect(location.pathname).toBe('/'));
    expect(result.current.chat).toBeNull();
  });

  it('says why the chat could not load and tries again', async () => {
    fake = startFakeOnboarding({
      'GET /api/onboarding/chat': { status: 500, answer: { error: { message: 'The server is starting.' } } },
    });
    const { result, unmount } = renderHook(() => useOnboardingChat());
    await waitFor(() => expect(result.current.failure).toBe('The server is starting.'));
    fake.stop();
    fake = startFakeOnboarding({ 'GET /api/onboarding/chat': { answer: createChat(createPrompt()) } });
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.chat).not.toBeNull());
    expect(result.current.failure).toBeNull();
    unmount();
  });

  it('ignores a chat that arrives after the page closed', async () => {
    let answer = (_chat: unknown) => {};
    let refuse = (_reason: unknown) => {};
    fake = startFakeOnboarding({
      'GET /api/onboarding/chat': {
        answer: () =>
          new Promise((resolve, reject) => {
            answer = resolve;
            refuse = reject;
          }),
      },
    });
    const first = renderHook(() => useOnboardingChat());
    await waitFor(() => expect(fake?.requests).toHaveLength(1));
    first.unmount();
    answer(createChat(createPrompt()));
    const second = renderHook(() => useOnboardingChat());
    await waitFor(() => expect(fake?.requests).toHaveLength(2));
    second.unmount();
    refuse(new Error('gone'));
    await Promise.resolve();
    expect(first.result.current.chat).toBeNull();
    expect(second.result.current.failure).toBeNull();
  });
});
