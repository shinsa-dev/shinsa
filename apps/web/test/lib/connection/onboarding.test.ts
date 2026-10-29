import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  refreshOnboardingStatus,
  replyToOnboarding,
  requestOnboardingFlow,
  requestPrivacySettings,
  requestRootSuggestions,
  resetOnboardingStatus,
  restartOnboarding,
  updateRoots,
  useOnboardingStatus,
} from '@/lib/connection/onboarding.ts';
import { useRoute } from '@/router.ts';
import { spyOnToasts } from '../../support/commands.ts';
import {
  createFlow,
  createOnboardingStatus,
  createStep,
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

describe('the setup requests', () => {
  it('reads the setup, sends a reply and refreshes the status after it', async () => {
    const flow = createFlow(createStep());
    fake = startFakeOnboarding({
      'GET /api/onboarding/flow': { answer: flow },
      'POST /api/onboarding/flow': { answer: createFlow(null) },
      'GET /api/onboarding': { answer: createOnboardingStatus() },
      'GET /api/onboarding/roots?refresh=1': { answer: createSuggestions([['/Users/me/Developer', 2]]) },
    });
    expect(await requestOnboardingFlow()).toEqual(flow);
    const answered = await act(() =>
      replyToOnboarding({ type: 'answer', stepId: 'merge', values: ['squash'] })
    );
    expect(answered.step).toBeNull();
    expect(fake.requests[1]).toEqual({
      path: '/api/onboarding/flow',
      method: 'POST',
      body: { type: 'answer', stepId: 'merge', values: ['squash'] },
    });
    await waitFor(() => expect(fake?.requests.at(-1)?.path).toBe('/api/onboarding'));
    expect((await requestRootSuggestions()).suggestions[0]?.repoCount).toBe(2);
  });

  it('says what went wrong when the server answers without a reason', async () => {
    fake = startFakeOnboarding({});
    globalThis.fetch = (async () => new Response('gateway down', { status: 502 })) as unknown as typeof fetch;
    await expect(requestOnboardingFlow()).rejects.toThrow('Shinsa answered with status 502.');
  });

  it('starts setup again and opens it, or says why it could not', async () => {
    fake = startFakeOnboarding({
      'POST /api/onboarding/flow': { answer: createFlow(createStep()) },
      'GET /api/onboarding': { answer: createOnboardingStatus() },
    });
    const route = renderHook(() => useRoute());
    await act(() => restartOnboarding());
    expect(fake.requests[0]).toMatchObject({ method: 'POST', body: { type: 'restart' } });
    await waitFor(() => expect(route.result.current).toEqual({ name: 'onboarding' }));
    fake.stop();
    fake = startFakeOnboarding({
      'POST /api/onboarding/flow': { status: 400, answer: { error: { message: 'Busy.' } } },
    });
    await restartOnboarding();
    expect(toasts.error).toHaveBeenCalledWith('Busy.');
  });
});

describe('System Settings for a private folder', () => {
  it('asks the engine to open Full Disk Access, and says how to get there when it cannot', async () => {
    let opened = true;
    fake = startFakeOnboarding({ 'POST /api/onboarding/privacy': { answer: () => ({ ok: opened }) } });
    expect(await requestPrivacySettings()).toBe(true);
    expect(toasts.error).not.toHaveBeenCalled();
    opened = false;
    expect(await requestPrivacySettings()).toBe(false);
    expect(toasts.error).toHaveBeenCalledWith(
      'System Settings did not open. Open it yourself and go to Privacy & Security → Full Disk Access.'
    );
  });
});
