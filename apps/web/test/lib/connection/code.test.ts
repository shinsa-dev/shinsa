import { afterEach, describe, expect, it, mock } from 'bun:test';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  applySearchLine,
  CODE_READ_BUDGET,
  CODE_READ_LIMIT,
  CODE_SEARCH_LIMIT,
  holdLoaded,
  requestFileWrite,
  requestTaskRefs,
  resolveCodeUrl,
  resolveRawUrl,
  resolveReadSize,
  resolveReadVersion,
  resolveRefsVersion,
  resolveSearchUrl,
  useCodeRead,
  useFileContent,
  useFileDiff,
  useRepoPaths,
  useRepoSearch,
  useRepoTree,
  useRepoTrees,
  useTaskDiff,
  useTaskRefs,
} from '@/lib/connection/code.ts';
import { createTask } from '../../support/state.ts';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function serve(respond: (url: string) => Response | Promise<Response>) {
  const fetch = mock(async (url: string, _init?: RequestInit) => respond(url));
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

describe('resolveReadSize', () => {
  it('counts the characters of every string and key, and a little for every other value', () => {
    expect(resolveReadSize('abc')).toBe(3);
    expect(resolveReadSize({ path: 'ab', lines: [1, null, true] })).toBe(4 + 2 + 5 + 24);
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

  it('shows the last answer of a read at once in a new view, even for a newer version', async () => {
    serve(() => Response.json({ content: 'one' }));
    const first = renderHook(() => useCodeRead('/api/tasks/swr/refs', 'a'));
    await waitFor(() => expect(first.result.current.status).toBe('ready'));
    first.unmount();
    const { answer } = deferred();
    const fresh = renderHook(() => useCodeRead('/api/tasks/swr/refs', 'b'));
    expect(fresh.result.current).toEqual({ status: 'ready', value: { content: 'one' } });
    act(() => answer('/api/tasks/swr/refs?v=b', Response.json({ content: 'two' })));
    await waitFor(() => expect(fresh.result.current).toEqual({ status: 'ready', value: { content: 'two' } }));
  });

  it('keeps the reads used last and forgets the oldest past the limit', async () => {
    const fetch = serve((url) => Response.json({ url }));
    const task = createTask({ id: 'lru' });
    const first = await requestTaskRefs(task);
    for (let index = 0; index < CODE_READ_LIMIT; index += 1) {
      if (index === CODE_READ_LIMIT / 2) await requestTaskRefs(task);
      await requestTaskRefs(createTask({ id: `lru-${index}` }));
    }
    expect(await requestTaskRefs(task)).toEqual(first);
    expect(fetch).toHaveBeenCalledTimes(CODE_READ_LIMIT + 1);
    await requestTaskRefs(createTask({ id: 'lru-0' }));
    expect(fetch).toHaveBeenCalledTimes(CODE_READ_LIMIT + 2);
  });

  it('keeps only the newest version of a read once it answers', async () => {
    const fetch = serve((url) => Response.json({ url }));
    const task = createTask({ id: 'versioned', stage: 'building' });
    await requestTaskRefs(task);
    await requestTaskRefs({ ...task, stage: 'awaiting_review' });
    expect(fetch).toHaveBeenCalledTimes(2);
    await requestTaskRefs({ ...task, stage: 'awaiting_review' });
    expect(fetch).toHaveBeenCalledTimes(2);
    await requestTaskRefs(task);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('drops an older version that answers after a newer one', async () => {
    const { answer } = deferred();
    const url = '/api/tasks/late/blob?ref=working';
    const older = renderHook(() => useCodeRead(url, '1'));
    const newer = renderHook(() => useCodeRead(url, '2'));
    act(() => answer(`${url}&v=2`, Response.json({ content: 'two' })));
    await waitFor(() => expect(newer.result.current).toEqual({ status: 'ready', value: { content: 'two' } }));
    act(() => answer(`${url}&v=1`, Response.json({ content: 'one' })));
    await waitFor(() => expect(older.result.current).toEqual({ status: 'ready', value: { content: 'one' } }));
    const next = renderHook(() => useCodeRead(url, '3'));
    expect(next.result.current).toEqual({ status: 'ready', value: { content: 'two' } });
  });

  it('forgets the reads used longest ago once their answers pass the byte budget', async () => {
    const half = 'x'.repeat(CODE_READ_BUDGET / 2);
    const fetch = serve(() => Response.json({ content: half }));
    const first = renderHook(() => useCodeRead('/api/tasks/budget/blob?path=a'));
    await waitFor(() => expect(first.result.current.status).toBe('ready'));
    const second = renderHook(() => useCodeRead('/api/tasks/budget/blob?path=b'));
    await waitFor(() => expect(second.result.current.status).toBe('ready'));
    expect(fetch).toHaveBeenCalledTimes(2);
    renderHook(() => useCodeRead('/api/tasks/budget/blob?path=b'));
    expect(fetch).toHaveBeenCalledTimes(2);
    const again = renderHook(() => useCodeRead('/api/tasks/budget/blob?path=a'));
    expect(again.result.current).toEqual({ status: 'loading' });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
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
    renderHook(() => useFileDiff(task, SHA, SHA, 'src/a.ts'));
    renderHook(() =>
      useRepoSearch(task, SHA, {
        query: 'needle',
        regex: true,
        caseSensitive: true,
        wholeWord: true,
        glob: ' *.ts ',
      })
    );
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(7));
    expect(fetch.mock.calls.map(([url]) => url).sort()).toEqual(
      [
        `/api/tasks/reads/refs?v=${encodeURIComponent(resolveRefsVersion(task))}`,
        `/api/tasks/reads/paths?ref=${SHA}`,
        '/api/tasks/reads/tree?ref=working&dir=src&v=9',
        `/api/tasks/reads/blob?ref=${SHA}&path=src%2Fa.ts`,
        `/api/tasks/reads/diff?base=${SHA}&head=${SHA}&path=src%2Fa.ts`,
        `/api/tasks/reads/diff?base=${SHA}&head=working&v=9`,
        `/api/tasks/reads/search?ref=${SHA}&q=needle&regex=1&case=1&word=1&glob=*.ts`,
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
    expect(renderHook(() => useFileDiff(task, null, SHA, 'a.ts')).result.current.status).toBe('idle');
    expect(renderHook(() => useFileDiff(task, SHA, null, 'a.ts')).result.current.status).toBe('idle');
    const search = { query: '', regex: false, caseSensitive: false, wholeWord: false, glob: '' };
    expect(renderHook(() => useRepoSearch(task, SHA, search)).result.current.loaded.status).toBe('idle');
    expect(
      renderHook(() => useRepoSearch(task, null, { ...search, query: 'x' })).result.current.loaded.status
    ).toBe('idle');
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('requestFileWrite', () => {
  it('saves a file, hands back the disk when it changed under you, and throws a refusal', async () => {
    const write = { path: 'src/a.ts', content: 'b', base: 'a' };
    const fetch = serve(() => Response.json({ path: 'src/a.ts', changed: true }));
    expect(await requestFileWrite('t 1', write)).toEqual({ kind: 'saved', changed: true });
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/tasks/t%201/file');
    serve(() =>
      Response.json({ error: { code: 'file_changed', message: 'x' }, content: 'theirs' }, { status: 409 })
    );
    expect(await requestFileWrite('t1', write)).toEqual({ kind: 'changed', content: 'theirs' });
    serve(() => Response.json({ error: { message: 'This task is merged.' } }, { status: 400 }));
    await expect(requestFileWrite('t1', write)).rejects.toThrow('This task is merged.');
    serve(() => new Response('not json', { status: 409 }));
    await expect(requestFileWrite('t1', write)).rejects.toThrow('Shinsa answered with status 409.');
  });
});

describe('holdLoaded', () => {
  it('keeps what is on screen while the next read loads, and takes anything else as it comes', () => {
    const shown = { status: 'ready', value: 1 } as const;
    expect(holdLoaded(shown, { status: 'loading' })).toBe(shown);
    expect(holdLoaded<number>({ status: 'idle' }, { status: 'loading' })).toEqual({ status: 'loading' });
    expect(holdLoaded(shown, { status: 'ready', value: 2 })).toEqual({ status: 'ready', value: 2 });
    expect(holdLoaded(shown, { status: 'error', message: 'x' })).toEqual({ status: 'error', message: 'x' });
  });
});

function streamOf(lines: unknown[]) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
      controller.close();
    },
  });
  return new Response(body, { headers: { 'content-type': 'application/x-ndjson' } });
}

describe('useRepoSearch', () => {
  const search = { query: 'needle', regex: false, caseSensitive: false, wholeWord: false, glob: '' };
  const match = (line: number) => ({ path: 'a.ts', line, column: 1, text: 'needle' });

  it('shows matches as they stream in, then how the search ended, and keeps the finished search', async () => {
    const fetch = serve(() =>
      streamOf([
        { kind: 'matches', matches: [match(1)] },
        { kind: 'matches', matches: [match(2)] },
        { kind: 'done', result: { ref: SHA, matches: [], truncated: true, timedOut: false } },
      ])
    );
    const task = createTask({ id: 'stream-1' });
    const first = renderHook(() => useRepoSearch(task, SHA, search));
    expect(first.result.current).toEqual({ loaded: { status: 'loading' }, searching: true });
    await waitFor(() => expect(first.result.current.searching).toBe(false));
    expect(first.result.current.loaded).toEqual({
      status: 'ready',
      value: { ref: SHA, matches: [match(1), match(2)], truncated: true, timedOut: false },
    });
    expect(fetch.mock.calls[0]?.[1]).toEqual({ headers: { accept: 'application/x-ndjson' } });
    const again = renderHook(() => useRepoSearch(task, SHA, search));
    expect(again.result.current.loaded.status).toBe('ready');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('shows the matches found so far while the search goes on', async () => {
    const encoder = new TextEncoder();
    let finish = () => {};
    serve(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                encoder.encode(`${JSON.stringify({ kind: 'matches', matches: [match(5)] })}\n`)
              );
              finish = () => {
                controller.enqueue(
                  encoder.encode(
                    JSON.stringify({
                      kind: 'done',
                      result: { ref: SHA, matches: [], truncated: false, timedOut: false },
                    })
                  )
                );
                controller.close();
              };
            },
          })
        )
    );
    const view = renderHook(() => useRepoSearch(createTask({ id: 'stream-5' }), SHA, search));
    await waitFor(() =>
      expect(view.result.current).toMatchObject({
        loaded: { value: { matches: [match(5)] } },
        searching: true,
      })
    );
    act(() => finish());
    await waitFor(() => expect(view.result.current.searching).toBe(false));
  });

  it('says why a search failed, from the server’s line or the connection', async () => {
    serve(() => streamOf([{ kind: 'failed', code: 'read_failed', message: 'Bad pattern.' }]));
    const failed = renderHook(() => useRepoSearch(createTask({ id: 'stream-2' }), SHA, search));
    await waitFor(() =>
      expect(failed.result.current).toEqual({
        loaded: { status: 'error', message: 'Bad pattern.' },
        searching: false,
      })
    );
    serve(() => Response.json({ error: { message: 'No such task.' } }, { status: 404 }));
    const refused = renderHook(() => useRepoSearch(createTask({ id: 'stream-3' }), SHA, search));
    await waitFor(() =>
      expect(refused.result.current.loaded).toEqual({ status: 'error', message: 'No such task.' })
    );
  });

  it('stops listening once the page leaves', async () => {
    const { answer } = deferred();
    const task = createTask({ id: 'stream-4' });
    const view = renderHook(() => useRepoSearch(task, SHA, search));
    view.unmount();
    answer(
      `${resolveSearchUrl(task, SHA, search)}`,
      streamOf([{ kind: 'failed', code: 'x', message: 'late' }])
    );
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
  });

  it('keeps the last results on screen while the next search runs', async () => {
    serve(() =>
      streamOf([
        { kind: 'matches', matches: [match(1)] },
        { kind: 'done', result: { ref: SHA, matches: [], truncated: false, timedOut: false } },
      ])
    );
    const task = createTask({ id: 'stream-hold' });
    const view = renderHook(({ query }) => useRepoSearch(task, SHA, { ...search, query }), {
      initialProps: { query: 'first' },
    });
    await waitFor(() => expect(view.result.current.searching).toBe(false));
    const { answer } = deferred();
    view.rerender({ query: 'second' });
    expect(view.result.current).toEqual({
      loaded: {
        status: 'ready',
        value: { ref: SHA, matches: [match(1)], truncated: false, timedOut: false },
      },
      searching: true,
    });
    act(() =>
      answer(
        `${resolveSearchUrl(task, SHA, { ...search, query: 'second' })}`,
        streamOf([{ kind: 'done', result: { ref: SHA, matches: [], truncated: false, timedOut: false } }])
      )
    );
    await waitFor(() => expect(view.result.current.searching).toBe(false));
    expect(view.result.current.loaded).toMatchObject({ value: { matches: [] } });
  });

  it('keeps only the last few finished searches', async () => {
    const fetch = serve(() =>
      streamOf([{ kind: 'done', result: { ref: SHA, matches: [], truncated: false, timedOut: false } }])
    );
    const task = createTask({ id: 'stream-many' });
    for (let index = 0; index <= CODE_SEARCH_LIMIT; index += 1) {
      const view = renderHook(() => useRepoSearch(task, SHA, { ...search, query: `q${index}` }));
      await waitFor(() => expect(view.result.current.searching).toBe(false));
      view.unmount();
    }
    const oldest = renderHook(() => useRepoSearch(task, SHA, { ...search, query: 'q0' }));
    expect(oldest.result.current.searching).toBe(true);
    await waitFor(() => expect(oldest.result.current.searching).toBe(false));
    expect(fetch).toHaveBeenCalledTimes(CODE_SEARCH_LIMIT + 2);
  });

  it('adds streamed matches in order and takes the ending from the last line', () => {
    const empty = { ref: SHA, matches: [], truncated: false, timedOut: false };
    const grown = applySearchLine(empty, { kind: 'matches', matches: [match(3)] });
    expect(applySearchLine(grown, { kind: 'done', result: { ...empty, timedOut: true } })).toEqual({
      ...empty,
      matches: [match(3)],
      timedOut: true,
    });
  });
});

describe('useRepoTrees', () => {
  it('settles a folder still loading when a large answer passes the byte budget', async () => {
    const { answer } = deferred();
    const task = createTask({ id: 'pending' });
    const trees = renderHook(() => useRepoTrees(task, SHA, ['src']));
    const tree = resolveCodeUrl(task.id, 'tree', { ref: SHA, dir: 'src' });
    const blob = renderHook(() => useCodeRead('/api/tasks/pending/blob?path=big'));
    act(() =>
      answer('/api/tasks/pending/blob?path=big', Response.json({ content: 'x'.repeat(CODE_READ_BUDGET + 1) }))
    );
    await waitFor(() => expect(blob.result.current.status).toBe('ready'));
    act(() => answer(tree, Response.json({ ref: SHA, dir: 'src', entries: [] })));
    await waitFor(() =>
      expect(trees.result.current.get('src')).toEqual({
        status: 'ready',
        value: { ref: SHA, dir: 'src', entries: [] },
      })
    );
  });

  it('reads every open folder once and says which failed', async () => {
    const fetch = serve((url) =>
      url.includes('dir=bad')
        ? Response.json({ error: { message: 'Gone.' } }, { status: 404 })
        : Response.json({ ref: SHA, dir: '', entries: [] })
    );
    const task = createTask({ id: 'trees' });
    const view = renderHook(({ dirs }) => useRepoTrees(task, SHA, dirs), {
      initialProps: { dirs: ['', 'bad'] },
    });
    expect(view.result.current.get('')).toEqual({ status: 'loading' });
    await waitFor(() =>
      expect(view.result.current.get('bad')).toEqual({ status: 'error', message: 'Gone.' })
    );
    expect(view.result.current.get('')).toEqual({
      status: 'ready',
      value: { ref: SHA, dir: '', entries: [] },
    });
    view.rerender({ dirs: [''] });
    view.unmount();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
