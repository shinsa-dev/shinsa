import { describe, expect, it } from 'bun:test';
import type { ChatAttachment } from '@shinsa/core';
import {
  canOpenAttachment,
  describeAttachment,
  resolveFileGlyph,
  resolveFileType,
  splitAttachments,
} from '@/lib/chat/attachments.ts';
import { resolveFileIcon } from '@/lib/code/file-icons.ts';

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
    expect(
      describeAttachment(attachment({ name: 'notes.pdf', mimeType: 'application/pdf', size: 2048 }))
    ).toBe('PDF · 2 KB');
  });

  it('leaves out what it does not know', () => {
    expect(describeAttachment(attachment({ name: 'notes', mimeType: null, size: 512 }))).toBe('512 B');
    expect(describeAttachment(attachment({ name: 'shot', mimeType: 'image/png', size: null }))).toBe('PNG');
    expect(describeAttachment(attachment({ name: 'notes', mimeType: 'text', size: null }))).toBe('');
    expect(describeAttachment(attachment({ name: 'notes', mimeType: null, size: null }))).toBe('');
  });
});

describe('resolveFileType', () => {
  it('reads the extension first, then a short MIME subtype, never a long vendor type', () => {
    expect(resolveFileType({ name: 'Q3 report.docx', mimeType: null })).toBe('DOCX');
    expect(resolveFileType({ name: 'log', mimeType: 'text/plain' })).toBe('PLAIN');
    expect(
      resolveFileType({
        name: 'deck',
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      })
    ).toBeNull();
    expect(resolveFileType({ name: 'archive.backup1', mimeType: null })).toBeNull();
  });
});

describe('resolveFileGlyph', () => {
  it('gives each kind of file its icon, by extension first', () => {
    expect(resolveFileGlyph({ name: 'spec.pdf', mimeType: null })).toBe('IconFileTypePdf');
    expect(resolveFileGlyph({ name: 'sales.xlsx', mimeType: null })).toBe('IconFileTypeTable');
    expect(resolveFileGlyph({ name: 'pitch.key', mimeType: null })).toBe('IconSlidesWide');
    expect(resolveFileGlyph({ name: 'brief.docx', mimeType: null })).toBe('IconFileText');
    expect(resolveFileGlyph({ name: 'build.zip', mimeType: null })).toBe('IconFileTypeArchive');
    expect(resolveFileGlyph({ name: 'index.ts', mimeType: null })).toBe('IconFileTypeTypescript');
    expect(resolveFileGlyph({ name: 'demo.mov', mimeType: null })).toBe('IconFileTypeMedia');
  });

  it('falls back to the MIME type when the name has no extension, then to a plain file', () => {
    expect(resolveFileGlyph({ name: 'recording', mimeType: 'audio/mpeg' })).toBe('IconFileTypeMedia');
    expect(resolveFileGlyph({ name: 'download', mimeType: 'application/pdf' })).toBe('IconFileTypePdf');
    expect(resolveFileGlyph({ name: 'bundle', mimeType: 'application/zip' })).toBe('IconFileTypeArchive');
    expect(resolveFileGlyph({ name: 'notes.txt', mimeType: 'text/plain' })).toBe('IconFileText');
    expect(resolveFileGlyph({ name: 'blob', mimeType: null })).toBe(resolveFileIcon('blob'));
  });
});

describe('canOpenAttachment', () => {
  it('opens what the browser can load, not a path on disk', () => {
    expect(canOpenAttachment({ url: '/api/attachments/1/a.pdf' })).toBe(true);
    expect(canOpenAttachment({ url: '/Users/me/a.pdf' })).toBe(false);
  });
});
