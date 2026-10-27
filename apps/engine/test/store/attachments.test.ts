import { describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ATTACHMENT_LIMIT_BYTES,
  ATTACHMENT_ROUTE,
  AttachmentStore,
  readAttachmentUpload,
} from '../../src/store/index.ts';
import { createTempDir } from '../helpers/index.ts';

const PNG = Buffer.from('fake png bytes').toString('base64');

describe('AttachmentStore', () => {
  test('writes an upload under its own id, with a safe file name, and finds it again by that name', () => {
    const dir = createTempDir();
    const store = new AttachmentStore(join(dir, 'attachments'));
    const image = store.write({ name: 'Screen Shot 1 (copy).PNG', mimeType: 'image/png', data: PNG });
    expect(image).toMatchObject({
      kind: 'image',
      name: 'Screen Shot 1 (copy).PNG',
      mimeType: 'image/png',
      size: 14,
    });
    expect(image.url).toMatch(/^\/api\/attachments\/[0-9a-f-]{36}\/Screen-Shot-1-copy\.png$/);
    expect(readFileSync(image.path, 'utf8')).toBe('fake png bytes');
    expect(store.selectFile(image.url.slice(ATTACHMENT_ROUTE.length))).toBe(image.path);

    const odd = store.write({ name: '…', mimeType: null, data: PNG });
    expect(odd).toMatchObject({ kind: 'file', name: '…', mimeType: null });
    expect(odd.url.endsWith('/file')).toBe(true);
  });

  test('refuses an empty or oversized file', () => {
    const store = new AttachmentStore(createTempDir());
    expect(() => store.write({ name: 'a.txt', mimeType: null, data: '' })).toThrow('The file is empty.');
    const big = Buffer.alloc(ATTACHMENT_LIMIT_BYTES + 1).toString('base64');
    expect(() => store.write({ name: 'a.bin', mimeType: null, data: big })).toThrow('the limit is 25 MB');
  });

  test('selects only an id and a plain file name that exist', () => {
    const dir = createTempDir();
    const store = new AttachmentStore(dir);
    const id = '01a17e51-96e1-7058-b2a3-52fd491e6258';
    mkdirSync(join(dir, id, 'folder.txt'), { recursive: true });
    for (const name of [
      `${id}/missing.txt`,
      `${id}/folder.txt`,
      `${id}/../x.txt`,
      `${id}/a/b.txt`,
      'not-an-id/a.txt',
      `${id}/.hidden`,
    ]) {
      expect(store.selectFile(name)).toBeNull();
    }
  });
});

describe('readAttachmentUpload', () => {
  test('keeps a well-formed upload and trims its name', () => {
    expect(readAttachmentUpload({ name: ' a.png ', mimeType: 'image/png', data: PNG })).toEqual({
      name: 'a.png',
      mimeType: 'image/png',
      data: PNG,
    });
    expect(readAttachmentUpload({ name: 'a', data: PNG }).mimeType).toBeNull();
  });

  test('refuses a bad name, type or body', () => {
    expect(() => readAttachmentUpload({ name: ' ', data: PNG })).toThrow('Name the file');
    expect(() => readAttachmentUpload({ name: 'x'.repeat(256), data: PNG })).toThrow('Name the file');
    expect(() => readAttachmentUpload({ name: 'a', mimeType: 'png', data: PNG })).toThrow('MIME type');
    expect(() => readAttachmentUpload({ name: 'a', mimeType: 3, data: PNG })).toThrow('MIME type');
    expect(() => readAttachmentUpload({ name: 'a', data: 'not base64!' })).toThrow('base64');
    expect(() => readAttachmentUpload({ name: 'a' })).toThrow('base64');
  });
});
