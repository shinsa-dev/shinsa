import { describe, expect, it } from 'bun:test';
import {
  type AttachmentDraft,
  canSendDraft,
  isUploading,
  listReadyAttachments,
  resolveAcceptedFiles,
  resolveDraftKind,
} from '@/lib/chat/attachment-drafts.ts';

const STORED = {
  kind: 'file' as const,
  name: 'a.txt',
  url: '/api/attachments/1/a.txt',
  path: '/data/attachments/1/a.txt',
  mimeType: null,
  size: 1,
};

const READY: AttachmentDraft = {
  key: 'r',
  name: 'a.txt',
  kind: 'file',
  mimeType: null,
  size: 1,
  preview: null,
  stored: STORED,
};

const UPLOADING: AttachmentDraft = {
  key: 'u',
  name: 'b.png',
  kind: 'image',
  mimeType: 'image/png',
  size: 2,
  preview: 'blob:x',
  stored: null,
};

describe('resolveAcceptedFiles', () => {
  it('takes every file that fits', () => {
    expect(resolveAcceptedFiles([{ size: 1 }, { size: 2 }], 0)).toEqual({
      accepted: [{ size: 1 }, { size: 2 }],
      refusal: null,
    });
  });

  it('leaves out empty and oversized files and says why', () => {
    expect(resolveAcceptedFiles([{ size: 0 }, { size: 26 * 1024 * 1024 }, { size: 3 }], 0)).toEqual({
      accepted: [{ size: 3 }],
      refusal: 'Each file must be 1 byte to 25 MB.',
    });
  });

  it('stops at ten files a message', () => {
    expect(resolveAcceptedFiles([{ size: 1 }, { size: 1 }], 9)).toEqual({
      accepted: [{ size: 1 }],
      refusal: 'Attach at most 10 files.',
    });
    expect(resolveAcceptedFiles([{ size: 1 }], 12).accepted).toEqual([]);
  });
});

describe('drafts', () => {
  it('reads the kind from the file type', () => {
    expect(resolveDraftKind({ type: 'image/png' })).toBe('image');
    expect(resolveDraftKind({ type: '' })).toBe('file');
  });

  it('lists only the uploaded attachments and knows when one is still uploading', () => {
    expect(listReadyAttachments([READY, UPLOADING])).toEqual([STORED]);
    expect(isUploading([READY])).toBe(false);
    expect(isUploading([READY, UPLOADING])).toBe(true);
  });

  it('sends text, attachments or both, never while busy or uploading', () => {
    expect(canSendDraft('Fix it', [], false)).toBe(true);
    expect(canSendDraft('  ', [READY], false)).toBe(true);
    expect(canSendDraft('  ', [], false)).toBe(false);
    expect(canSendDraft('Fix it', [READY, UPLOADING], false)).toBe(false);
    expect(canSendDraft('Fix it', [], true)).toBe(false);
  });
});
