import { afterEach, describe, expect, it, mock } from 'bun:test';
import { type AgentProviderInfo, KNOWN_AGENT_PROVIDERS } from '@shinsa/core';
import { renderHook, waitFor } from '@testing-library/react';
import { resetAgentProviders, useAgentProviders } from '@/lib/connection/models.ts';

const realFetch = globalThis.fetch;

const SERVED: AgentProviderInfo[] = [
  {
    id: 'claude',
    label: 'Claude',
    models: [{ id: 'claude-next', label: 'Claude Next', description: 'The newest model.' }],
  },
];

afterEach(() => {
  globalThis.fetch = realFetch;
  resetAgentProviders();
});

describe('useAgentProviders', () => {
  it('keeps the known providers when the list fails to load, and asks again next time', async () => {
    const failing = mock(async () => new Response('nope', { status: 500 }));
    globalThis.fetch = failing as unknown as typeof fetch;
    const first = renderHook(() => useAgentProviders());
    await waitFor(() => expect(failing).toHaveBeenCalledTimes(1));
    expect(first.result.current).toEqual(KNOWN_AGENT_PROVIDERS);
    renderHook(() => useAgentProviders());
    await waitFor(() => expect(failing).toHaveBeenCalledTimes(2));
  });

  it('loads the served list once and shares it with every reader', async () => {
    let answer = (_response: Response) => {};
    const served = mock(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        })
    );
    globalThis.fetch = served as unknown as typeof fetch;
    const early = renderHook(() => useAgentProviders());
    const live = renderHook(() => useAgentProviders());
    expect(live.result.current).toEqual(KNOWN_AGENT_PROVIDERS);
    early.unmount();
    answer(Response.json(SERVED));
    await waitFor(() => expect(live.result.current).toEqual(SERVED));
    expect(served).toHaveBeenCalledTimes(1);
    expect(served.mock.calls[0]).toEqual(['/api/providers'] as never);
    const later = renderHook(() => useAgentProviders());
    expect(later.result.current).toEqual(SERVED);
    expect(served).toHaveBeenCalledTimes(1);
  });
});
