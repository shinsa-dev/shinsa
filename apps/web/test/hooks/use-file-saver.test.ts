import { afterEach, describe, expect, it, mock } from 'bun:test';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useFileSaver } from '@/hooks/use-file-saver.ts';
import { selectSaved } from '@/lib/code/edits.ts';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function serve(respond: (body: { content: string; base: string | null }) => Response) {
  const fetch = mock(async (_url: string, init: RequestInit) => respond(JSON.parse(String(init.body))));
  globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
  return fetch;
}

function createBuffer(text: string) {
  const buffer = {
    text,
    readText: () => buffer.text,
    replaceText: (next: string) => {
      buffer.text = next;
    },
  };
  return buffer;
}

describe('useFileSaver', () => {
  it('saves your typing when the file closes, and shows it again over the same read', async () => {
    const fetch = serve(() => Response.json({ path: 'a.ts', changed: true }));
    const buffer = createBuffer('one');
    const ref = { current: buffer };
    const { result, unmount } = renderHook(() =>
      useFileSaver({ taskId: 'hook-1', path: 'a.ts', text: 'one', buffer: ref })
    );
    expect(result.current.start).toBe('one');
    buffer.text = 'two';
    act(() => result.current.edit());
    ref.current = null as never;
    unmount();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(selectSaved('hook-1', 'a.ts', 'one')).toBe('two'));
    const again = renderHook(() =>
      useFileSaver({ taskId: 'hook-1', path: 'a.ts', text: 'one', buffer: { current: createBuffer('two') } })
    );
    expect(again.result.current.start).toBe('two');
    again.unmount();
  });

  it('takes a newer read and merges it, and keeps a disk version that clashes with a notice', async () => {
    serve(() =>
      Response.json({ error: { code: 'file_changed', message: 'x' }, content: 'clash' }, { status: 409 })
    );
    const buffer = createBuffer('a\nb\n');
    const { result, rerender, unmount } = renderHook(
      ({ text }) => useFileSaver({ taskId: 'hook-2', path: 'a.ts', text, buffer: { current: buffer } }),
      { initialProps: { text: 'a\nb\n' as string | null } }
    );
    rerender({ text: 'a\nb\nc\n' });
    expect(buffer.text).toBe('a\nb\nc\n');
    rerender({ text: 'a\nb\nc\n' });
    buffer.text = 'mine';
    act(() => result.current.edit());
    unmount();
    await waitFor(() => expect(buffer.text).toBe('clash'));
  });

  it('does nothing for a file it may not edit', () => {
    const { result } = renderHook(() =>
      useFileSaver({ taskId: 'hook-3', path: null, text: 'x', buffer: { current: null } })
    );
    expect(result.current.start).toBe('x');
    act(() => result.current.edit());
    act(() => result.current.save());
    expect(result.current.state).toEqual({ saving: false, notice: null, refusal: null });
  });

  it('saves at once when asked, without waiting for a pause in the typing', async () => {
    const fetch = serve(() => Response.json({ path: 'a.ts', changed: true }));
    const buffer = createBuffer('one');
    const { result, unmount } = renderHook(() =>
      useFileSaver({ taskId: 'hook-4', path: 'a.ts', text: 'one', buffer: { current: buffer } })
    );
    buffer.text = 'one!';
    act(() => result.current.edit());
    act(() => result.current.save());
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1), { timeout: 300 });
    unmount();
  });
});
