import { afterEach, describe, expect, it, mock } from 'bun:test';
import {
  listTransferFiles,
  requestAttachmentUpload,
  serializeFileData,
} from '@/lib/connection/attachments.ts';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('serializeFileData', () => {
  it('encodes a file as base64, in chunks for large files', async () => {
    expect(await serializeFileData(new Blob(['hello']))).toBe('aGVsbG8=');
    const big = new Uint8Array(0x8000 * 2 + 5).fill(65);
    expect(atob(await serializeFileData(new Blob([big])))).toBe('A'.repeat(big.length));
  });
});

describe('requestAttachmentUpload', () => {
  it('posts the name, type and data, and names a pasted image that has none', async () => {
    const fetch = mock(async (_url: string, init: RequestInit) =>
      Response.json({ url: '/x', body: init.body })
    );
    globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
    await requestAttachmentUpload(new File(['hi'], 'notes.txt', { type: 'text/plain' }));
    await requestAttachmentUpload(new File(['hi'], ''));
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/attachments');
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1].body))).toEqual({
      name: 'notes.txt',
      mimeType: 'text/plain',
      data: 'aGk=',
    });
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1].body))).toMatchObject({
      name: 'Pasted image',
      mimeType: null,
    });
  });
});

describe('listTransferFiles', () => {
  it('lists the files of a paste or drop, and none without one', () => {
    const file = new File(['x'], 'a.txt');
    expect(listTransferFiles({ files: [file] } as unknown as DataTransfer)).toEqual([file]);
    expect(listTransferFiles(null)).toEqual([]);
  });
});
