import { describe, expect, it } from 'bun:test';
import type { ChatAttachment } from '@shinsa/core';
import { describeAttachment, splitAttachments } from '@/lib/chat/attachments.ts';

function attachment(overrides: Partial<ChatAttachment>): ChatAttachment {
  return {
    kind: 'image',
    name: 'shot.png',
    url: '/api/evidence/shot.png',
    mimeType: 'image/png',
    size: 2048,
    ...overrides,
  };
}

describe('splitAttachments', () => {
  it('shows images the browser can load as thumbnails and everything else as file chips', () => {
    const served = attachment({ url: '/api/evidence/a.png' });
    const remote = attachment({ url: 'https://example.com/b.png' });
    const plain = attachment({ url: 'http://example.com/b.png' });
    const inline = attachment({ url: 'data:image/png;base64,AAAA' });
    const blob = attachment({ url: 'blob:http://localhost/1' });
    const local = attachment({ url: '/Users/me/Desktop/c.png' });
    const file = attachment({ kind: 'file', name: 'notes.pdf', url: '/api/evidence/notes.pdf' });
    const { images, files } = splitAttachments([served, local, remote, file, plain, inline, blob]);
    expect(images).toEqual([served, remote, plain, inline, blob]);
    expect(files).toEqual([local, file]);
  });

  it('is empty for no attachments', () => {
    expect(splitAttachments([])).toEqual({ images: [], files: [] });
  });
});

describe('describeAttachment', () => {
  it('names the file type and size', () => {
    expect(describeAttachment(attachment({ mimeType: 'application/pdf', size: 2048 }))).toBe('PDF · 2 KB');
  });

  it('leaves out what it does not know', () => {
    expect(describeAttachment(attachment({ mimeType: null, size: 512 }))).toBe('512 B');
    expect(describeAttachment(attachment({ mimeType: 'image/png', size: null }))).toBe('PNG');
    expect(describeAttachment(attachment({ mimeType: 'text', size: null }))).toBe('');
    expect(describeAttachment(attachment({ mimeType: null, size: null }))).toBe('');
  });
});
