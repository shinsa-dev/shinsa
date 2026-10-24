import { afterEach, describe, expect, it, mock } from 'bun:test';
import type { TaskDiff } from '@shinsa/core';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useFileContent, useTaskDiff } from '@/lib/connection/files.ts';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function diff(note: string) {
  return { files: [], note } as unknown as TaskDiff;
}

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

describe('useTaskDiff', () => {
  it('loads the diff for a task revision', async () => {
    const fetch = serve(() => Response.json(diff('ready')));
    const { result } = renderHook(() => useTaskDiff('diff-ready', 3));
    expect(result.current).toEqual({ status: 'loading' });
    await waitFor(() => expect(result.current).toEqual({ status: 'ready', value: diff('ready') }));
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/tasks/diff-ready/diff?r=3');
  });

  it('shows the error message Shinsa sends', async () => {
    serve(() =>
      Response.json(
        { error: { code: 'no_worktree', message: 'This task has no worktree.' } },
        { status: 409 }
      )
    );
    const { result } = renderHook(() => useTaskDiff('diff-error', 1));
    await waitFor(() =>
      expect(result.current).toEqual({ status: 'error', message: 'This task has no worktree.' })
    );
  });

  it('falls back to the status when the error has no message', async () => {
    serve(() => Response.json({ error: {} }, { status: 500 }));
    const { result } = renderHook(() => useTaskDiff('diff-bare-error', 1));
    await waitFor(() =>
      expect(result.current).toEqual({ status: 'error', message: 'Shinsa answered with status 500.' })
    );
  });

  it('reports the status when the body is not JSON', async () => {
    serve(() => new Response('<html>Bad gateway</html>', { status: 502 }));
    const { result } = renderHook(() => useTaskDiff('diff-html', 1));
    await waitFor(() =>
      expect(result.current).toEqual({ status: 'error', message: 'Shinsa answered with status 502.' })
    );
  });

  it('treats an empty successful answer as a failure', async () => {
    serve(() => new Response('', { status: 200 }));
    const { result } = renderHook(() => useTaskDiff('diff-empty', 1));
    await waitFor(() =>
      expect(result.current).toEqual({ status: 'error', message: 'Shinsa answered with status 200.' })
    );
  });

  it('reports the status of a failed answer with an ordinary JSON body', async () => {
    serve(() => Response.json({ files: [] }, { status: 404 }));
    const { result } = renderHook(() => useTaskDiff('diff-404', 1));
    await waitFor(() =>
      expect(result.current).toEqual({ status: 'error', message: 'Shinsa answered with status 404.' })
    );
  });

  it('asks once for the same revision, however many readers it has', async () => {
    const fetch = serve(() => Response.json(diff('shared')));
    const first = renderHook(() => useTaskDiff('diff-shared', 1));
    const second = renderHook(() => useTaskDiff('diff-shared', 1));
    await waitFor(() => expect(second.result.current.status).toBe('ready'));
    await waitFor(() => expect(first.result.current.status).toBe('ready'));
    const third = renderHook(() => useTaskDiff('diff-shared', 1));
    await waitFor(() => expect(third.result.current.status).toBe('ready'));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('asks again after a failed request instead of caching the failure', async () => {
    const failing = serve(() => new Response('', { status: 503 }));
    const first = renderHook(() => useTaskDiff('diff-retry', 1));
    await waitFor(() => expect(first.result.current.status).toBe('error'));
    const healthy = serve(() => Response.json(diff('back')));
    const second = renderHook(() => useTaskDiff('diff-retry', 1));
    await waitFor(() => expect(second.result.current).toEqual({ status: 'ready', value: diff('back') }));
    expect(failing).toHaveBeenCalledTimes(1);
    expect(healthy).toHaveBeenCalledTimes(1);
  });

  it('encodes the task id in the request path', async () => {
    const fetch = serve(() => Response.json(diff('encoded')));
    const { result } = renderHook(() => useTaskDiff('task/with space', 1));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/tasks/task%2Fwith%20space/diff?r=1');
  });

  it('keeps a newer request cached when an evicted older one fails late', async () => {
    const pending: ((response: Response) => void)[] = [];
    const fetch = serve((url) =>
      url === '/api/tasks/diff-evict/diff?r=0'
        ? new Promise<Response>((resolve) => {
            pending.push(resolve);
          })
        : Response.json(diff('other'))
    );
    const evicted = renderHook(() => useTaskDiff('diff-evict', 0));
    const { rerender } = renderHook(({ revision }) => useTaskDiff('diff-evict', revision), {
      initialProps: { revision: 1 },
    });
    for (let revision = 2; revision <= 200; revision += 1) rerender({ revision });
    renderHook(() => useTaskDiff('diff-evict', 0));
    act(() => pending[0]?.(new Response('', { status: 500 })));
    await waitFor(() => expect(evicted.result.current.status).toBe('error'));
    renderHook(() => useTaskDiff('diff-evict', 0));
    expect(fetch.mock.calls.filter(([url]) => url === '/api/tasks/diff-evict/diff?r=0')).toHaveLength(2);
  });

  it('forgets the oldest request once it holds 200', async () => {
    const fetch = serve(() => Response.json(diff('many')));
    const { rerender } = renderHook(({ revision }) => useTaskDiff('diff-many', revision), {
      initialProps: { revision: 0 },
    });
    for (let revision = 1; revision <= 200; revision += 1) rerender({ revision });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(201));
    renderHook(() => useTaskDiff('diff-many', 200));
    expect(fetch).toHaveBeenCalledTimes(201);
    renderHook(() => useTaskDiff('diff-many', 0));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(202));
  });

  it('shows loading for a new task and ignores the old task answering late', async () => {
    const { answer } = deferred();
    const { result, rerender } = renderHook(({ taskId }) => useTaskDiff(taskId, 1), {
      initialProps: { taskId: 'diff-old' },
    });
    rerender({ taskId: 'diff-new' });
    expect(result.current).toEqual({ status: 'loading' });
    const old = renderHook(() => useTaskDiff('diff-old', 1));
    act(() => answer('/api/tasks/diff-old/diff?r=1', Response.json(diff('old'))));
    await waitFor(() => expect(old.result.current.status).toBe('ready'));
    expect(result.current).toEqual({ status: 'loading' });
    answer('/api/tasks/diff-new/diff?r=1', Response.json(diff('new')));
    await waitFor(() => expect(result.current).toEqual({ status: 'ready', value: diff('new') }));
  });

  it('keeps showing the last diff while a newer revision loads', async () => {
    const { answer } = deferred();
    const { result, rerender } = renderHook(({ revision }) => useTaskDiff('diff-revise', revision), {
      initialProps: { revision: 1 },
    });
    answer('/api/tasks/diff-revise/diff?r=1', Response.json(diff('first')));
    await waitFor(() => expect(result.current).toEqual({ status: 'ready', value: diff('first') }));
    rerender({ revision: 2 });
    expect(result.current).toEqual({ status: 'ready', value: diff('first') });
    answer('/api/tasks/diff-revise/diff?r=2', Response.json(diff('second')));
    await waitFor(() => expect(result.current).toEqual({ status: 'ready', value: diff('second') }));
  });

  it('keeps the newer revision when the older one answers late', async () => {
    const { answer } = deferred();
    const { result, rerender } = renderHook(({ revision }) => useTaskDiff('diff-late', revision), {
      initialProps: { revision: 1 },
    });
    rerender({ revision: 2 });
    const older = renderHook(() => useTaskDiff('diff-late', 1));
    act(() => answer('/api/tasks/diff-late/diff?r=2', Response.json(diff('second'))));
    await waitFor(() => expect(result.current).toEqual({ status: 'ready', value: diff('second') }));
    act(() => answer('/api/tasks/diff-late/diff?r=1', Response.json(diff('first'))));
    await waitFor(() => expect(older.result.current.status).toBe('ready'));
    expect(result.current).toEqual({ status: 'ready', value: diff('second') });
  });

  it('keeps the newer revision when the older one fails late', async () => {
    const { answer } = deferred();
    const { result, rerender } = renderHook(({ revision }) => useTaskDiff('diff-late-error', revision), {
      initialProps: { revision: 1 },
    });
    rerender({ revision: 2 });
    const older = renderHook(() => useTaskDiff('diff-late-error', 1));
    act(() => answer('/api/tasks/diff-late-error/diff?r=2', Response.json(diff('second'))));
    await waitFor(() => expect(result.current).toEqual({ status: 'ready', value: diff('second') }));
    act(() => answer('/api/tasks/diff-late-error/diff?r=1', new Response('', { status: 500 })));
    await waitFor(() => expect(older.result.current.status).toBe('error'));
    expect(result.current).toEqual({ status: 'ready', value: diff('second') });
  });

  it('ignores a late error from a task it moved away from', async () => {
    const { answer } = deferred();
    const { result, rerender } = renderHook(({ taskId }) => useTaskDiff(taskId, 1), {
      initialProps: { taskId: 'diff-left' },
    });
    rerender({ taskId: 'diff-right' });
    const left = renderHook(() => useTaskDiff('diff-left', 1));
    act(() => answer('/api/tasks/diff-left/diff?r=1', new Response('', { status: 500 })));
    await waitFor(() => expect(left.result.current.status).toBe('error'));
    expect(result.current).toEqual({ status: 'loading' });
  });
});

describe('useFileContent', () => {
  it('stays idle and asks for nothing without a path', () => {
    const fetch = serve(() => Response.json({ content: 'x' }));
    const { result } = renderHook(() => useFileContent('file-idle', null, 1));
    expect(result.current).toEqual({ status: 'idle' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('loads a file at a revision with its path encoded', async () => {
    const fetch = serve(() => Response.json({ content: 'export const a = 1;\n' }));
    const { result } = renderHook(() => useFileContent('file-load', 'src/a b.ts', 4));
    await waitFor(() => expect(result.current).toEqual({ status: 'ready', value: 'export const a = 1;\n' }));
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/tasks/file-load/file?path=src%2Fa%20b.ts&r=4');
  });

  it('passes on a file that has no content', async () => {
    serve(() => Response.json({ content: null }));
    const { result } = renderHook(() => useFileContent('file-null', 'image.png', 1));
    await waitFor(() => expect(result.current).toEqual({ status: 'ready', value: null }));
  });

  it('goes back to idle when the path is cleared', async () => {
    serve(() => Response.json({ content: 'a' }));
    const { result, rerender } = renderHook(({ path }) => useFileContent('file-clear', path, 1), {
      initialProps: { path: 'a.ts' as string | null },
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    rerender({ path: null });
    expect(result.current).toEqual({ status: 'idle' });
  });

  it('shows loading for another file and ignores the first one answering late', async () => {
    const { answer } = deferred();
    const { result, rerender } = renderHook(({ path }) => useFileContent('file-switch', path, 1), {
      initialProps: { path: 'a.ts' },
    });
    rerender({ path: 'b.ts' });
    const first = renderHook(() => useFileContent('file-switch', 'a.ts', 1));
    act(() => answer('/api/tasks/file-switch/file?path=a.ts&r=1', Response.json({ content: 'a' })));
    await waitFor(() => expect(first.result.current.status).toBe('ready'));
    expect(result.current).toEqual({ status: 'loading' });
    answer('/api/tasks/file-switch/file?path=b.ts&r=1', Response.json({ content: 'b' }));
    await waitFor(() => expect(result.current).toEqual({ status: 'ready', value: 'b' }));
  });
});
