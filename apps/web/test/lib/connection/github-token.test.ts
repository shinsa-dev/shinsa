import { afterEach, describe, expect, it, mock } from 'bun:test';
import { renderHook, waitFor } from '@testing-library/react';
import { requestGitHubTokenWrite, useGitHubToken } from '@/lib/connection/github-token.ts';
import { readFetchRequest } from '../../support/fetch.ts';

const realFetch = globalThis.fetch;

const SAVED = { login: 'kai', saved: true, savedAt: 5, machineLogin: false };

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('useGitHubToken', () => {
  it('reads your token’s state only once it is enabled', async () => {
    const served = mock(async () => Response.json(SAVED));
    globalThis.fetch = served as unknown as typeof fetch;
    const off = renderHook(() => useGitHubToken(false));
    expect(off.result.current[0]).toBeNull();
    expect(served).not.toHaveBeenCalled();
    const on = renderHook(() => useGitHubToken(true));
    await waitFor(() => expect(on.result.current[0]).toEqual(SAVED));
    const call = await readFetchRequest(...(served.mock.calls[0] as unknown as [Request]));
    expect(call.path).toBe('/api/github-token');
  });

  it('stays empty when the engine refuses', async () => {
    const refused = mock(async () => new Response('nope', { status: 500 }));
    globalThis.fetch = refused as unknown as typeof fetch;
    const read = renderHook(() => useGitHubToken(true));
    await waitFor(() => expect(refused).toHaveBeenCalledTimes(1));
    expect(read.result.current[0]).toBeNull();
  });
});

describe('requestGitHubTokenWrite', () => {
  it('posts the token, or null to remove it, and returns the new state', async () => {
    const served = mock(async () => Response.json({ ...SAVED, saved: false, savedAt: null }));
    globalThis.fetch = served as unknown as typeof fetch;
    expect(await requestGitHubTokenWrite(null)).toEqual({ ...SAVED, saved: false, savedAt: null });
    const call = await readFetchRequest(...(served.mock.calls[0] as unknown as [Request]));
    expect(call).toMatchObject({ path: '/api/github-token', method: 'POST', body: { token: null } });
  });
});
