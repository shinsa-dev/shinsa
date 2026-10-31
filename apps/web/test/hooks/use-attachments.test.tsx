import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { act, render, renderHook, waitFor } from '@testing-library/react';
import * as React from 'react';
import { type Attachments, useAttachments } from '@/hooks/use-attachments.ts';
import { spyOnToasts } from '../support/commands.ts';

const realFetch = globalThis.fetch;

let toasts: ReturnType<typeof spyOnToasts>;
let created: ReturnType<typeof spyOn>;
let revoked: ReturnType<typeof spyOn>;

beforeEach(() => {
  toasts = spyOnToasts();
  let made = 0;
  created = spyOn(URL, 'createObjectURL').mockImplementation(() => {
    made += 1;
    return `blob:preview-${made}`;
  });
  revoked = spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);
});

afterEach(() => {
  globalThis.fetch = realFetch;
  toasts.restore();
  created.mockRestore();
  revoked.mockRestore();
});

function serve(respond: (name: string) => Response) {
  globalThis.fetch = mock(async (_url: string, init: RequestInit) =>
    respond(JSON.parse(String(init.body)).name)
  ) as unknown as typeof globalThis.fetch;
}

function stored(name: string) {
  return {
    kind: 'file',
    name,
    url: `/api/attachments/1/${name}`,
    path: `/d/${name}`,
    mimeType: null,
    size: 1,
  };
}

describe('useAttachments', () => {
  it('uploads what you add, previews images, and lists each once it is stored', async () => {
    serve((name) => Response.json(stored(name)));
    const { result } = renderHook(() => useAttachments());
    act(() =>
      result.current.add([new File(['x'], 'a.png', { type: 'image/png' }), new File(['y'], 'b.txt')])
    );
    expect(result.current.drafts.map((draft) => [draft.kind, draft.preview])).toEqual([
      ['image', 'blob:preview-1'],
      ['file', null],
    ]);
    await waitFor(() => expect(result.current.ready.map((item) => item.name)).toEqual(['a.png', 'b.txt']));
    expect(created).toHaveBeenCalledTimes(1);
    act(() => result.current.remove(result.current.drafts[0]?.key ?? ''));
    expect(revoked).toHaveBeenCalledWith('blob:preview-1');
    act(() => result.current.remove('missing'));
    act(() => result.current.clear());
    expect(result.current.drafts).toEqual([]);
  });

  it('drops a file the server refuses and says why', async () => {
    serve(() => Response.json({ error: { message: 'The file is empty.' } }, { status: 400 }));
    const { result } = renderHook(() => useAttachments());
    act(() => result.current.add([new File(['x'], 'a.txt'), new File(['x'], '')]));
    await waitFor(() => expect(result.current.drafts).toEqual([]));
    expect(toasts.error).toHaveBeenCalledWith('Couldn’t attach a.txt: The file is empty.');
    expect(toasts.error).toHaveBeenCalledWith('Couldn’t attach the file: The file is empty.');
  });

  it('refuses files over the limits, ignores an empty transfer, and revokes previews when it goes', () => {
    serve((name) => Response.json(stored(name)));
    const { result, unmount } = renderHook(() => useAttachments());
    act(() => result.current.add([]));
    expect(result.current.addTransfer(null)).toBe(false);
    act(() => {
      result.current.addTransfer({
        files: [new File([], 'empty.png', { type: 'image/png' })],
      } as unknown as DataTransfer);
    });
    expect(toasts.error).toHaveBeenCalledWith('Each file must be between 1 byte and 25 MB.');
    act(() => result.current.add([new File(['x'], 'c.png', { type: 'image/png' })]));
    unmount();
    expect(revoked).toHaveBeenCalledWith('blob:preview-1');
  });

  it('makes new previews when a hidden page shows again', () => {
    serve((name) => Response.json(stored(name)));
    const seen: { attachments: Attachments | null } = { attachments: null };
    function Composer() {
      seen.attachments = useAttachments();
      return null;
    }
    const page = (mode: 'visible' | 'hidden') => (
      <React.Activity mode={mode}>
        <Composer />
      </React.Activity>
    );
    const { rerender } = render(page('visible'));
    act(() => seen.attachments?.add([new File(['x'], 'a.png', { type: 'image/png' })]));
    expect(seen.attachments?.drafts[0]?.preview).toBe('blob:preview-1');
    act(() => rerender(page('hidden')));
    expect(revoked).toHaveBeenCalledWith('blob:preview-1');
    act(() => rerender(page('visible')));
    expect(seen.attachments?.drafts[0]?.preview).toBe('blob:preview-2');
    expect(revoked).not.toHaveBeenCalledWith('blob:preview-2');
  });

  it('previews an uploaded image from its server copy, never from the file again', async () => {
    serve((name) => Response.json(stored(name)));
    const seen: { attachments: Attachments | null } = { attachments: null };
    function Composer() {
      seen.attachments = useAttachments();
      return null;
    }
    const page = (mode: 'visible' | 'hidden') => (
      <React.Activity mode={mode}>
        <Composer />
      </React.Activity>
    );
    const { rerender } = render(page('visible'));
    act(() => seen.attachments?.add([new File(['x'], 'a.png', { type: 'image/png' })]));
    expect(seen.attachments?.drafts[0]?.preview).toBe('blob:preview-1');
    await waitFor(() => expect(seen.attachments?.drafts[0]?.preview).toBe('/api/attachments/1/a.png'));
    expect(revoked).toHaveBeenCalledWith('blob:preview-1');
    act(() => seen.attachments?.add([new File(['y'], 'b.png', { type: 'image/png' })]));
    expect(seen.attachments?.drafts.map((draft) => draft.preview)).toEqual([
      '/api/attachments/1/a.png',
      'blob:preview-2',
    ]);
    await waitFor(() => expect(seen.attachments?.ready).toHaveLength(2));
    act(() => rerender(page('hidden')));
    act(() => rerender(page('visible')));
    expect(seen.attachments?.drafts.map((draft) => draft.preview)).toEqual([
      '/api/attachments/1/a.png',
      '/api/attachments/1/b.png',
    ]);
    expect(created).toHaveBeenCalledTimes(2);
  });
});
