import { afterEach, describe, expect, it, mock } from 'bun:test';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  resolveCodeUrl,
  resolveRawUrl,
  resolveReadVersion,
  resolveRefsVersion,
  useCodeRead,
  useFileContent,
  useRepoPaths,
  useRepoSearch,
  useRepoTree,
  useTaskDiff,
  useTaskRefs,
} from '@/lib/connection/code.ts';
import { createTask } from '../../support/state.ts';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function serve(respond: (url: string) => Response | Promise<Response>) {
  const fetch = mock(async (url: string) => respond(url));
  globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
  return fetch;
}

function deferred() {
  const answers = new Map<string, (response: Response) => void>();
  const fetch = serve(
    (url) =>
      new Promise<Response>((resolve) => {
        answers.set(url, resolve);
      })
  );
  return { fetch, answer: (url: string, response: Response) => answers.get(url)?.(response) };
}

const SHA = 'a'.repeat(40);

describe('resolveCodeUrl', () => {
  it('encodes the task and leaves out empty parameters', () => {
    expect(resolveCodeUrl('a/b', 'blob', { ref: SHA, path: 'src/a b.ts', glob: '', q: null })).toBe(
      `/api/tasks/a%2Fb/blob?ref=${SHA}&path=src%2Fa+b.ts`
    );
    expect(resolveCodeUrl('t', 'refs')).toBe('/api/tasks/t/refs');
    expect(resolveRawUrl('t', 'working', 'logo.png')).toBe('/api/tasks/t/raw?ref=working&path=logo.png');
  });
});

describe('versions', () => {
  it('reads the refs again only when what pins the code changes, not on every task event', () => {
    const task = createTask({ id: 't', stage: 'building' });
    const chatted = { ...task, updatedAt: task.updatedAt + 1000, priority: 'urgent' as const };
    expect(resolveRefsVersion(chatted)).toBe(resolveRefsVersion(task));
    expect(resolveRefsVersion({ ...task, stage: 'awaiting_review' })).not.toBe(resolveRefsVersion(task));
    expect(resolveRefsVersion({ ...task, fixRounds: 2 })).not.toBe(resolveRefsVersion(task));
  });

  it('a commit never changes, the working copy changes with the task', () => {
    const task = createTask({ id: 't', updatedAt: 42 });
    expect(resolveReadVersion(task, SHA)).toBe('');
    expect(resolveReadVersion(task, 'working')).toBe('42');
  });
});

describe('useCodeRead', () => {
  it('loads once per address, however many readers it has', async () => {
    const fetch = serve(() => Response.json({ ok: 1 }));
    const first = renderHook(() => useCodeRead('/api/tasks/shared/refs'));
    const second = renderHook(() => useCodeRead('/api/tasks/shared/refs'));
    await waitFor(() => expect(first.result.current).toEqual({ status: 'ready', value: { ok: 1 } }));
    await waitFor(() => expect(second.result.current.status).toBe('ready'));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('stays idle without an address', () => {
    const fetch = serve(() => Response.json({}));
    expect(renderHook(() => useCodeRead(null)).result.current).toEqual({ status: 'idle' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows the message Shinsa sends and asks again after a failure', async () => {
    serve(() => Response.json({ error: { code: 'x', message: 'No such commit.' } }, { status: 400 }));
    const failed = renderHook(() => useCodeRead('/api/tasks/fail/refs'));
    await waitFor(() =>
      expect(failed.result.current).toEqual({ status: 'error', message: 'No such commit.' })
    );
    const healthy = serve(() => Response.json({ back: true }));
    const again = renderHook(() => useCodeRead('/api/tasks/fail/refs'));
    await waitFor(() => expect(again.result.current.status).toBe('ready'));
    expect(healthy).toHaveBeenCalledTimes(1);
  });

  it('keeps the last answer while a newer version of the same read loads', async () => {
    const { answer } = deferred();
    const { result, rerender } = renderHook(
      ({ version }) => useCodeRead('/api/tasks/live/blob?ref=working', version),
      {
        initialProps: { version: '1' },
      }
    );
    act(() => answer('/api/tasks/live/blob?ref=working&v=1', Response.json({ content: 'one' })));
    await waitFor(() => expect(result.current).toEqual({ status: 'ready', value: { content: 'one' } }));
    rerender({ version: '2' });
    expect(result.current).toEqual({ status: 'ready', value: { content: 'one' } });
    act(() => answer('/api/tasks/live/blob?ref=working&v=2', Response.json({ content: 'two' })));
    await waitFor(() => expect(result.current).toEqual({ status: 'ready', value: { content: 'two' } }));
  });

  it('shows loading for another read and ignores the first one answering late', async () => {
    const { answer } = deferred();
    const { result, rerender } = renderHook(({ url }) => useCodeRead(url), {
      initialProps: { url: '/api/tasks/x/blob?path=a' },
    });
    rerender({ url: '/api/tasks/x/blob?path=b' });
    expect(result.current).toEqual({ status: 'loading' });
    act(() => answer('/api/tasks/x/blob?path=a', Response.json({ content: 'a' })));
    expect(result.current).toEqual({ status: 'loading' });
    act(() => answer('/api/tasks/x/blob?path=b', Response.json({ content: 'b' })));
    await waitFor(() => expect(result.current).toEqual({ status: 'ready', value: { content: 'b' } }));
    rerender({ url: null as unknown as string });
    expect(result.current).toEqual({ status: 'idle' });
  });

  it('forgets the oldest read once it holds 300', async () => {
    const fetch = serve(() => Response.json({}));
    const { rerender, result } = renderHook(({ path }) => useCodeRead(`/api/tasks/many/blob?path=${path}`), {
      initialProps: { path: 0 },
    });
    for (let path = 1; path <= 300; path += 1) rerender({ path });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(fetch).toHaveBeenCalledTimes(301);
    rerender({ path: 300 });
    expect(fetch).toHaveBeenCalledTimes(301);
    rerender({ path: 0 });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(302));
  });

  it('keeps a newer read when an evicted older one fails late', async () => {
    const pending: ((response: Response) => void)[] = [];
    serve((url) =>
      url === '/api/tasks/evict/refs'
        ? new Promise<Response>((resolve) => {
            pending.push(resolve);
          })
        : Response.json({})
    );
    const first = renderHook(() => useCodeRead('/api/tasks/evict/refs'));
    const { rerender, result } = renderHook(({ path }) => useCodeRead(`/api/tasks/evict/blob?path=${path}`), {
      initialProps: { path: 0 },
    });
    for (let path = 1; path <= 300; path += 1) rerender({ path });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const second = renderHook(() => useCodeRead('/api/tasks/evict/refs'));
    act(() => pending[0]?.(new Response('', { status: 500 })));
    await waitFor(() => expect(first.result.current.status).toBe('error'));
    act(() => pending[1]?.(Response.json({ fresh: true })));
    await waitFor(() => expect(second.result.current).toEqual({ status: 'ready', value: { fresh: true } }));
    const third = renderHook(() => useCodeRead('/api/tasks/evict/refs'));
    await waitFor(() => expect(third.result.current).toEqual({ status: 'ready', value: { fresh: true } }));
  });
});

describe('the code reads', () => {
  it('ask for refs, paths, a folder, a file, a diff and a search at a pinned commit', async () => {
    const fetch = serve(() => Response.json({}));
    const task = createTask({ id: 'reads', updatedAt: 9 });
    renderHook(() => useTaskRefs(task));
    renderHook(() => useRepoPaths(task, SHA));
    renderHook(() => useRepoTree(task, 'working', 'src'));
    renderHook(() => useFileContent(task, SHA, 'src/a.ts'));
    renderHook(() => useTaskDiff(task, SHA, 'working'));
    renderHook(() =>
      useRepoSearch(task, SHA, { query: 'needle', regex: true, caseSensitive: true, glob: ' *.ts ' })
    );
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(6));
    expect(fetch.mock.calls.map(([url]) => url).sort()).toEqual(
      [
        `/api/tasks/reads/refs?v=${encodeURIComponent(resolveRefsVersion(task))}`,
        `/api/tasks/reads/paths?ref=${SHA}`,
        '/api/tasks/reads/tree?ref=working&dir=src&v=9',
        `/api/tasks/reads/blob?ref=${SHA}&path=src%2Fa.ts`,
        `/api/tasks/reads/diff?base=${SHA}&head=working&v=9`,
        `/api/tasks/reads/search?ref=${SHA}&q=needle&regex=1&case=1&glob=*.ts`,
      ].sort()
    );
  });

  it('asks for nothing until the ref, the path or the query is known', () => {
    const fetch = serve(() => Response.json({}));
    const task = createTask({ id: 'idle' });
    expect(renderHook(() => useRepoPaths(task, null)).result.current.status).toBe('idle');
    expect(renderHook(() => useFileContent(task, SHA, null)).result.current.status).toBe('idle');
    expect(renderHook(() => useFileContent(task, null, 'a.ts')).result.current.status).toBe('idle');
    expect(renderHook(() => useTaskDiff(task, null, SHA)).result.current.status).toBe('idle');
    expect(renderHook(() => useTaskDiff(task, SHA, null)).result.current.status).toBe('idle');
    const search = { query: '', regex: false, caseSensitive: false, glob: '' };
    expect(renderHook(() => useRepoSearch(task, SHA, search)).result.current.status).toBe('idle');
    expect(renderHook(() => useRepoSearch(task, null, { ...search, query: 'x' })).result.current.status).toBe(
      'idle'
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
