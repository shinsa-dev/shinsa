import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  refreshOnboardingStatus,
  replyToOnboarding,
  requestOnboardingChat,
  requestRootSuggestions,
  resetOnboardingStatus,
  restartOnboarding,
  updateRoots,
  useOnboardingStatus,
} from '@/lib/connection/onboarding.ts';
import { useRoute } from '@/router.ts';
import { spyOnToasts } from '../../support/commands.ts';
import {
  createChat,
  createOnboardingStatus,
  createPrompt,
  createSuggestions,
  startFakeOnboarding,
} from '../../support/onboarding.ts';

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

describe('the onboarding status', () => {
  it('loads once for every reader and updates when the folders are saved', async () => {
    const saved = createOnboardingStatus({ configured: ['/Users/me/Developer'] });
    fake = startFakeOnboarding({
      'GET /api/onboarding': { answer: createOnboardingStatus({}, false) },
      'POST /api/onboarding/setup': { answer: saved },
    });
    await refreshOnboardingStatus();
    const first = renderHook(() => useOnboardingStatus());
    const second = renderHook(() => useOnboardingStatus());
    expect(first.result.current?.completed).toBe(false);
    expect(fake.requests.filter((request) => request.path === '/api/onboarding')).toHaveLength(1);
    await act(async () => {
      expect(await updateRoots(['~/Developer'], 'Folder added.')).toBe(true);
    });
    await waitFor(() => expect(second.result.current).toEqual(saved));
    expect(toasts.success).toHaveBeenCalledWith('Folder added.');
    expect(fake.requests.at(-1)).toEqual({
      path: '/api/onboarding/setup',
      method: 'POST',
      body: { roots: ['~/Developer'] },
    });
  });

  it('keeps the last status when a refresh fails, and asks again on the next one', async () => {
    fake = startFakeOnboarding({ 'GET /api/onboarding': { status: 500, answer: 'broken' } });
    await refreshOnboardingStatus();
    renderHook(() => useOnboardingStatus());
    await waitFor(() => expect(fake?.requests).toHaveLength(2));
    await act(() => Promise.resolve());
  });

  it('forgets the status on reset, so the next reader asks the server again', async () => {
    fake = startFakeOnboarding({ 'GET /api/onboarding': { answer: createOnboardingStatus() } });
    await refreshOnboardingStatus();
    act(() => resetOnboardingStatus());
    const reader = renderHook(() => useOnboardingStatus());
    expect(reader.result.current).toBeNull();
    await waitFor(() => expect(reader.result.current).not.toBeNull());
    expect(fake.requests.filter((request) => request.path === '/api/onboarding')).toHaveLength(2);
  });

  it('shows the reason the server refused a change', async () => {
    fake = startFakeOnboarding({
      'POST /api/onboarding/setup': {
        status: 400,
        answer: { error: { code: 'roots_invalid', message: '/nope is not a folder on this machine.' } },
      },
    });
    expect(await updateRoots(['/nope'], 'Folder added.')).toBe(false);
    expect(toasts.error).toHaveBeenCalledWith('/nope is not a folder on this machine.');
  });
});

describe('the setup chat requests', () => {
  it('reads the chat, sends a reply and refreshes the status after it', async () => {
    const chat = createChat(createPrompt());
    fake = startFakeOnboarding({
      'GET /api/onboarding/chat': { answer: chat },
      'POST /api/onboarding/chat': { answer: createChat(null) },
      'GET /api/onboarding': { answer: createOnboardingStatus() },
      'GET /api/onboarding/roots?refresh=1': { answer: createSuggestions([['/Users/me/Developer', 2]]) },
    });
    expect(await requestOnboardingChat()).toEqual(chat);
    const answered = await act(() =>
      replyToOnboarding({ type: 'choose', questionId: 'merge', values: ['squash'] })
    );
    expect(answered.prompt).toBeNull();
    expect(fake.requests[1]).toEqual({
      path: '/api/onboarding/chat',
      method: 'POST',
      body: { type: 'choose', questionId: 'merge', values: ['squash'] },
    });
    await waitFor(() => expect(fake?.requests.at(-1)?.path).toBe('/api/onboarding'));
    expect((await requestRootSuggestions()).suggestions[0]?.repoCount).toBe(2);
  });

  it('says what went wrong when the server answers without a reason', async () => {
    fake = startFakeOnboarding({});
    globalThis.fetch = (async () => new Response('gateway down', { status: 502 })) as unknown as typeof fetch;
    await expect(requestOnboardingChat()).rejects.toThrow('Shinsa answered with status 502.');
  });

  it('starts setup again and opens it, or says why it could not', async () => {
    fake = startFakeOnboarding({
      'POST /api/onboarding/chat': { answer: createChat(createPrompt()) },
      'GET /api/onboarding': { answer: createOnboardingStatus() },
    });
    const route = renderHook(() => useRoute());
    await act(() => restartOnboarding());
    expect(fake.requests[0]).toMatchObject({ method: 'POST', body: { type: 'restart' } });
    await waitFor(() => expect(route.result.current).toEqual({ name: 'onboarding' }));
    fake.stop();
    fake = startFakeOnboarding({
      'POST /api/onboarding/chat': { status: 400, answer: { error: { message: 'Busy.' } } },
    });
    await restartOnboarding();
    expect(toasts.error).toHaveBeenCalledWith('Busy.');
  });
});
