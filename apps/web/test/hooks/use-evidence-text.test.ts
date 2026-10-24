import { afterEach, describe, expect, it, mock } from 'bun:test';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useEvidenceText } from '@/hooks/use-evidence-text.ts';

const realFetch = globalThis.fetch;

function answer(body: string, status = 200) {
  return mock(async () => new Response(body, { status }));
}

function holdRequests() {
  const requests: {
    promise: Promise<Response>;
    resolve: (response: Response) => void;
    reject: (error: Error) => void;
  }[] = [];
  globalThis.fetch = mock(() => {
    const request = Promise.withResolvers<Response>();
    requests.push(request);
    return request.promise;
  }) as unknown as typeof globalThis.fetch;
  return requests;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('useEvidenceText', () => {
  it('reads the text of stored evidence', async () => {
    const fetch = answer('All 42 tests passed.');
    globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
    const { result } = renderHook(() => useEvidenceText('/api/evidence/run.log'));
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toBe('All 42 tests passed.'));
    expect(fetch).toHaveBeenCalledWith('/api/evidence/run.log');
  });

  it('says why it could not read evidence the server refused', async () => {
    globalThis.fetch = answer('missing', 404) as unknown as typeof globalThis.fetch;
    const { result } = renderHook(() => useEvidenceText('/api/evidence/gone.log'));
    await waitFor(() =>
      expect(result.current).toBe('Couldn’t read this evidence. Shinsa answered with status 404.')
    );
  });

  it('passes on the reason the server gave for refusing', async () => {
    globalThis.fetch = mock(async () =>
      Response.json({ error: { message: 'That evidence was cleaned up.' } }, { status: 410 })
    ) as unknown as typeof globalThis.fetch;
    const { result } = renderHook(() => useEvidenceText('/api/evidence/old.log'));
    await waitFor(() =>
      expect(result.current).toBe('Couldn’t read this evidence. That evidence was cleaned up.')
    );
  });

  it('says it could not reach the server', async () => {
    globalThis.fetch = mock(async () => {
      throw new Error('Network is offline.');
    }) as unknown as typeof globalThis.fetch;
    const { result } = renderHook(() => useEvidenceText('/api/evidence/run.log'));
    await waitFor(() => expect(result.current).toBe('Couldn’t read this evidence. Couldn’t reach Shinsa.'));
  });

  it('shows nothing from the previous evidence while the next one loads', async () => {
    let release: (response: Response) => void = () => undefined;
    globalThis.fetch = answer('First log') as unknown as typeof globalThis.fetch;
    const { result, rerender } = renderHook(({ uri }) => useEvidenceText(uri), {
      initialProps: { uri: '/api/evidence/first.log' },
    });
    await waitFor(() => expect(result.current).toBe('First log'));
    globalThis.fetch = mock(
      () => new Promise<Response>((resolve) => (release = resolve))
    ) as unknown as typeof globalThis.fetch;
    rerender({ uri: '/api/evidence/second.log' });
    expect(result.current).toBeNull();
    release(new Response('Second log'));
    await waitFor(() => expect(result.current).toBe('Second log'));
  });

  it('drops an answer that arrives after it stopped showing that evidence', async () => {
    const requests = holdRequests();
    const { result, rerender } = renderHook(({ uri }) => useEvidenceText(uri), {
      initialProps: { uri: '/api/evidence/old.log' },
    });
    rerender({ uri: '/api/evidence/new.log' });
    requests[1]?.resolve(new Response('New log'));
    await waitFor(() => expect(result.current).toBe('New log'));
    const late = new Response('Old log');
    const body = late.text();
    late.text = () => body;
    await act(async () => {
      requests[0]?.resolve(late);
      await body;
    });
    expect(result.current).toBe('New log');
  });

  it('drops a failure that arrives after it stopped showing that evidence', async () => {
    const requests = holdRequests();
    const { result, rerender } = renderHook(({ uri }) => useEvidenceText(uri), {
      initialProps: { uri: '/api/evidence/old.log' },
    });
    rerender({ uri: '/api/evidence/new.log' });
    requests[1]?.resolve(new Response('New log'));
    await waitFor(() => expect(result.current).toBe('New log'));
    await act(async () => {
      requests[0]?.reject(new Error('Too late.'));
      await expect(requests[0]?.promise).rejects.toThrow('Too late.');
    });
    expect(result.current).toBe('New log');
  });
});
