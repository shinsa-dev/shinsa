import { describe, expect, it } from 'bun:test';
import type { ChatAttachment } from '@shinsa/core';
import {
  canOpenAttachment,
  describeAttachment,
  resolveFileLook,
  resolveFileType,
  splitAttachments,
} from '@/lib/chat/attachments.ts';

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

describe('resolveFileLook', () => {
  it('gives each kind of file its icon and tone', () => {
    expect(resolveFileLook({ name: 'spec.pdf', mimeType: null })).toEqual({
      icon: 'IconFileTypePdf',
      tone: 'red',
    });
    expect(resolveFileLook({ name: 'sales.xlsx', mimeType: null })).toEqual({
      icon: 'IconFileTypeTable',
      tone: 'green',
    });
    expect(resolveFileLook({ name: 'pitch.key', mimeType: null })).toEqual({
      icon: 'IconSlidesWide',
      tone: 'orange',
    });
    expect(resolveFileLook({ name: 'brief.docx', mimeType: null })).toEqual({
      icon: 'IconFileText',
      tone: 'blue',
    });
    expect(resolveFileLook({ name: 'build.zip', mimeType: null })).toEqual({
      icon: 'IconFileTypeArchive',
      tone: 'amber',
    });
    expect(resolveFileLook({ name: 'index.ts', mimeType: null })).toEqual({
      icon: 'IconFileTypeTypescript',
      tone: 'blue',
    });
    expect(resolveFileLook({ name: 'demo.mov', mimeType: null })).toEqual({
      icon: 'IconFileTypeMedia',
      tone: 'purple',
    });
  });

  it('falls back to the MIME type, then to a plain neutral file', () => {
    expect(resolveFileLook({ name: 'recording', mimeType: 'audio/mpeg' }).tone).toBe('purple');
    expect(resolveFileLook({ name: 'download', mimeType: 'application/pdf' }).tone).toBe('red');
    expect(resolveFileLook({ name: 'bundle', mimeType: 'application/zip' }).tone).toBe('amber');
    expect(resolveFileLook({ name: 'notes.txt', mimeType: 'text/plain' })).toEqual({
      icon: 'IconFileText',
      tone: 'neutral',
    });
    expect(resolveFileLook({ name: 'README', mimeType: null }).tone).toBe('neutral');
  });
});

describe('canOpenAttachment', () => {
  it('opens what the browser can load, not a path on disk', () => {
    expect(canOpenAttachment({ url: '/api/attachments/1/a.pdf' })).toBe(true);
    expect(canOpenAttachment({ url: '/Users/me/a.pdf' })).toBe(false);
  });
});
