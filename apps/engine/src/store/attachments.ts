import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DomainError, type StoredAttachment } from '@shinsa/core';

export const ATTACHMENT_ROUTE = '/api/attachments/';

export const ATTACHMENT_LIMIT_BYTES = 25 * 1024 * 1024;

export const ATTACHMENT_REQUEST_LIMIT_BYTES = Math.ceil((ATTACHMENT_LIMIT_BYTES * 4) / 3) + 64 * 1024;

const NAME_LIMIT = 255;

const FILE_NAME_LIMIT = 120;

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const FILE_NAME = /^[A-Za-z0-9][\w-]*(?:\.[\w-]+)*$/;

const MIME_TYPE = /^[\w.+-]+\/[\w.+-]+$/;

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

export interface AttachmentUpload {
  name: string;
  mimeType: string | null;
  data: string;
}

function resolveFileName(name: string) {
  const [stem = '', extension = ''] = /^(.*?)((?:\.[A-Za-z0-9]{1,10})?)$/.exec(name)?.slice(1) ?? [];
  const safe = stem
    .replace(/[^\w-]+/g, '-')
    .replace(/^[-_]+|-+$/g, '')
    .slice(0, FILE_NAME_LIMIT);
  return `${safe || 'file'}${extension.toLowerCase()}`;
}

export function readAttachmentUpload(body: Record<string, unknown>): AttachmentUpload {
  const { name, mimeType, data } = body;
  if (typeof name !== 'string' || name.trim().length === 0 || name.length > NAME_LIMIT) {
    throw new DomainError('attachment_name_invalid', 'Name the file in at most 255 characters.');
  }
  if (
    mimeType !== undefined &&
    mimeType !== null &&
    (typeof mimeType !== 'string' || !MIME_TYPE.test(mimeType))
  ) {
    throw new DomainError('attachment_type_invalid', 'Give the file type as a MIME type such as image/png.');
  }
  if (typeof data !== 'string' || !BASE64.test(data)) {
    throw new DomainError('attachment_data_invalid', 'Send the file as base64.');
  }
  return { name: name.trim(), mimeType: mimeType ?? null, data };
}

export class AttachmentStore {
  readonly #dir: string;

  constructor(dir: string) {
    this.#dir = dir;
  }

  write(upload: AttachmentUpload): StoredAttachment {
    const bytes = Buffer.from(upload.data, 'base64');
    if (bytes.byteLength === 0) throw new DomainError('attachment_empty', 'The file is empty.');
    if (bytes.byteLength > ATTACHMENT_LIMIT_BYTES) {
      throw new DomainError(
        'attachment_too_large',
        `The file is over ${ATTACHMENT_LIMIT_BYTES / 1024 / 1024} MB.`
      );
    }
    const id = Bun.randomUUIDv7();
    const fileName = resolveFileName(upload.name);
    const folder = join(this.#dir, id);
    mkdirSync(folder, { recursive: true });
    const path = join(folder, fileName);
    writeFileSync(path, bytes);
    return {
      kind: upload.mimeType?.startsWith('image/') ? 'image' : 'file',
      name: upload.name,
      url: `${ATTACHMENT_ROUTE}${id}/${fileName}`,
      path,
      mimeType: upload.mimeType,
      size: bytes.byteLength,
    };
  }

  selectFile(name: string) {
    const [id = '', fileName = '', ...rest] = name.split('/');
    if (rest.length > 0 || !ID.test(id) || !FILE_NAME.test(fileName)) return null;
    const path = join(this.#dir, id, fileName);
    return existsSync(path) && statSync(path).isFile() ? path : null;
  }
}
