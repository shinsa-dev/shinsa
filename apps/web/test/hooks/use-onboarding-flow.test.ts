import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useOnboardingFlow } from '@/hooks/use-onboarding-flow.ts';
import { navigate, useRoute } from '@/router.ts';
import { spyOnToasts } from '../support/commands.ts';
import {
  createFlow,
  createOnboardingStatus,
  createStep,
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

describe('useOnboardingFlow', () => {
  it('loads the step, marks what is being sent and slides forward to the next one', async () => {
    let reply = (_flow: unknown) => {};
    const next = createFlow(createStep({ id: 'plans' }));
    fake = startFakeOnboarding({
      'GET /api/onboarding/flow': { answer: createFlow(createStep()) },
      'POST /api/onboarding/flow': {
        answer: () =>
          new Promise((resolve) => {
            reply = resolve;
          }),
      },
      'GET /api/onboarding': { answer: createOnboardingStatus() },
    });
    const { result } = renderHook(() => useOnboardingFlow());
    await waitFor(() => expect(result.current.flow?.step?.id).toBe('merge'));
    let sent: Promise<boolean> = Promise.resolve(false);
    act(() => {
      sent = result.current.answer('merge', ['rebase'], 'rebase');
    });
    await waitFor(() => expect(result.current.pending).toBe('rebase'));
    await act(async () => {
      reply(next);
      expect(await sent).toBe(true);
    });
    expect(result.current.pending).toBeNull();
    expect(result.current.flow).toEqual(next);
    expect(result.current.direction).toBe('forward');
    expect(fake.requests.find((request) => request.method === 'POST')?.body).toEqual({
      type: 'answer',
      stepId: 'merge',
      values: ['rebase'],
    });
  });

  it('opens an earlier step and slides back to it, and checks again without sending anything', async () => {
    const back = createFlow(createStep({ id: 'model' }));
    fake = startFakeOnboarding({
      'GET /api/onboarding/flow': { answer: createFlow(createStep()) },
      'POST /api/onboarding/flow': { answer: back },
      'GET /api/onboarding': { answer: createOnboardingStatus() },
    });
    const { result } = renderHook(() => useOnboardingFlow());
    await waitFor(() => expect(result.current.flow).not.toBeNull());
    await act(async () => {
      expect(await result.current.open('model')).toBe(true);
    });
    expect(result.current.direction).toBe('back');
    expect(fake.requests.find((request) => request.method === 'POST')?.body).toEqual({
      type: 'open',
      stepId: 'model',
    });
    await act(async () => {
      expect(await result.current.refresh()).toBe(true);
    });
    expect(result.current.flow?.step?.id).toBe('merge');
    await act(async () => {
      await result.current.answer('merge', ['squash']);
    });
    expect(fake.requests.filter((request) => request.method === 'POST')).toHaveLength(2);
  });

  it('shows a refused reply as a toast and stays on the step', async () => {
    fake = startFakeOnboarding({
      'GET /api/onboarding/flow': { answer: createFlow(createStep()) },
      'POST /api/onboarding/flow': {
        status: 400,
        answer: { error: { code: 'step_stale', message: 'That step is no longer open.' } },
      },
    });
    const { result } = renderHook(() => useOnboardingFlow());
    await waitFor(() => expect(result.current.flow).not.toBeNull());
    await act(async () => {
      expect(await result.current.answer('merge', ['x'])).toBe(false);
    });
    expect(toasts.error).toHaveBeenCalledWith('That step is no longer open.');
    expect(result.current.flow?.step?.id).toBe('merge');
  });

  it('goes Home when setup is already finished', async () => {
    act(() => navigate('/onboarding'));
    fake = startFakeOnboarding({ 'GET /api/onboarding/flow': { answer: createFlow(null) } });
    const route = renderHook(() => useRoute());
    renderHook(() => useOnboardingFlow());
    await waitFor(() => expect(route.result.current).toEqual({ name: 'home' }));
  });

  it('says why setup could not load, and tries again', async () => {
    fake = startFakeOnboarding({
      'GET /api/onboarding/flow': { status: 500, answer: { error: { message: 'The server is down.' } } },
    });
    const { result, unmount } = renderHook(() => useOnboardingFlow());
    await waitFor(() => expect(result.current.failure).toBe('The server is down.'));
    fake.stop();
    fake = startFakeOnboarding({ 'GET /api/onboarding/flow': { answer: createFlow(createStep()) } });
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.flow).not.toBeNull());
    expect(result.current.failure).toBeNull();
    unmount();
  });

  it('ignores an answer that arrives after the page left', async () => {
    let reply = (_flow: unknown) => {};
    fake = startFakeOnboarding({
      'GET /api/onboarding/flow': {
        answer: () =>
          new Promise((resolve) => {
            reply = resolve;
          }),
      },
    });
    const { result, unmount } = renderHook(() => useOnboardingFlow());
    await waitFor(() => expect(fake?.requests).toHaveLength(1));
    unmount();
    await act(async () => reply(createFlow(createStep())));
    expect(result.current.flow).toBeNull();
  });

  it('ignores a failure that arrives after the page left', async () => {
    let fail = (_error: unknown) => {};
    fake = startFakeOnboarding({});
    globalThis.fetch = (() =>
      new Promise((_resolve, reject) => {
        fail = reject;
      })) as unknown as typeof fetch;
    const { result, unmount } = renderHook(() => useOnboardingFlow());
    unmount();
    await act(async () => fail(new Error('gone')));
    expect(result.current.failure).toBeNull();
  });
});
