import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useAttachments } from '@/hooks/use-attachments.ts';
import { spyOnToasts } from '../support/commands.ts';

const realFetch = globalThis.fetch;

let toasts: ReturnType<typeof spyOnToasts>;
let created: ReturnType<typeof spyOn>;
let revoked: ReturnType<typeof spyOn>;

beforeEach(() => {
  toasts = spyOnToasts();
  created = spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview');
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
      ['image', 'blob:preview'],
      ['file', null],
    ]);
    await waitFor(() => expect(result.current.ready.map((item) => item.name)).toEqual(['a.png', 'b.txt']));
    act(() => result.current.remove(result.current.drafts[0]?.key ?? ''));
    expect(revoked).toHaveBeenCalledWith('blob:preview');
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
    expect(revoked).toHaveBeenCalledWith('blob:preview');
  });
});
