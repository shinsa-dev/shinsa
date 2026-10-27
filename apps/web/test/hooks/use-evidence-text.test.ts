import { afterEach, describe, expect, it, mock } from 'bun:test';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useEvidenceText } from '@/hooks/use-evidence-text.ts';
import { EVIDENCE_TEXT_LIMIT } from '@/lib/evidence/texts.ts';

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
    const { result } = renderHook(() => useEvidenceText('/api/evidence/hook-run.log'));
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toBe('All 42 tests passed.'));
    expect(fetch).toHaveBeenCalledWith('/api/evidence/hook-run.log');
  });

  it('says why it could not read evidence the server refused', async () => {
    globalThis.fetch = answer('missing', 404) as unknown as typeof globalThis.fetch;
    const { result } = renderHook(() => useEvidenceText('/api/evidence/hook-gone.log'));
    await waitFor(() =>
      expect(result.current).toBe('Couldn’t read this evidence. Shinsa answered with status 404.')
    );
  });

  it('passes on the reason the server gave for refusing', async () => {
    globalThis.fetch = mock(async () =>
      Response.json({ error: { message: 'That evidence was cleaned up.' } }, { status: 410 })
    ) as unknown as typeof globalThis.fetch;
    const { result } = renderHook(() => useEvidenceText('/api/evidence/hook-old.log'));
    await waitFor(() =>
      expect(result.current).toBe('Couldn’t read this evidence. That evidence was cleaned up.')
    );
  });

  it('says it could not reach the server', async () => {
    globalThis.fetch = mock(async () => {
      throw new Error('Network is offline.');
    }) as unknown as typeof globalThis.fetch;
    const { result } = renderHook(() => useEvidenceText('/api/evidence/hook-offline.log'));
    await waitFor(() => expect(result.current).toBe('Couldn’t read this evidence. Couldn’t reach Shinsa.'));
  });

  it('shows nothing from the previous evidence while the next one loads', async () => {
    let release: (response: Response) => void = () => undefined;
    globalThis.fetch = answer('First log') as unknown as typeof globalThis.fetch;
    const { result, rerender } = renderHook(({ uri }) => useEvidenceText(uri), {
      initialProps: { uri: '/api/evidence/hook-first.log' },
    });
    await waitFor(() => expect(result.current).toBe('First log'));
    globalThis.fetch = mock(
      () => new Promise<Response>((resolve) => (release = resolve))
    ) as unknown as typeof globalThis.fetch;
    rerender({ uri: '/api/evidence/hook-second.log' });
    expect(result.current).toBeNull();
    release(new Response('Second log'));
    await waitFor(() => expect(result.current).toBe('Second log'));
  });

  it('drops an answer that arrives after it stopped showing that evidence', async () => {
    const requests = holdRequests();
    const { result, rerender } = renderHook(({ uri }) => useEvidenceText(uri), {
      initialProps: { uri: '/api/evidence/hook-old.log' },
    });
    rerender({ uri: '/api/evidence/hook-new.log' });
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
      initialProps: { uri: '/api/evidence/hook-older.log' },
    });
    rerender({ uri: '/api/evidence/hook-newer.log' });
    requests[1]?.resolve(new Response('New log'));
    await waitFor(() => expect(result.current).toBe('New log'));
    await act(async () => {
      requests[0]?.reject(new Error('Too late.'));
      await expect(requests[0]?.promise).rejects.toThrow('Too late.');
    });
    expect(result.current).toBe('New log');
  });

  it('shows evidence read before at once, without reading it again', async () => {
    const fetch = answer('Cached log');
    globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
    const first = renderHook(() => useEvidenceText('/api/evidence/hook-cached.log'));
    await waitFor(() => expect(first.result.current).toBe('Cached log'));
    first.unmount();
    const second = renderHook(() => useEvidenceText('/api/evidence/hook-cached.log'));
    expect(second.result.current).toBe('Cached log');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps only the evidence read last', async () => {
    const fetch = answer('Log');
    globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
    for (let index = 0; index <= EVIDENCE_TEXT_LIMIT; index += 1) {
      const view = renderHook(() => useEvidenceText(`/api/evidence/hook-many-${index}.log`));
      await waitFor(() => expect(view.result.current).toBe('Log'));
      view.unmount();
    }
    const oldest = renderHook(() => useEvidenceText('/api/evidence/hook-many-0.log'));
    expect(oldest.result.current).toBeNull();
    await waitFor(() => expect(oldest.result.current).toBe('Log'));
    expect(fetch).toHaveBeenCalledTimes(EVIDENCE_TEXT_LIMIT + 2);
  });
});
