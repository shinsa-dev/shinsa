import type { StoredAttachment } from '@shinsa/core';
import { requestJson } from '@/lib/connection/http.ts';

export const ATTACHMENT_COUNT_LIMIT = 10;

export const ATTACHMENT_SIZE_LIMIT = 25 * 1024 * 1024;

const CHUNK = 0x8000;

export async function serializeFileData(file: Blob) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let start = 0; start < bytes.length; start += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(start, start + CHUNK));
  }
  return btoa(binary);
}

export async function requestAttachmentUpload(file: File) {
  return requestJson<StoredAttachment>('/api/attachments', {
    name: file.name || 'Pasted image',
    mimeType: file.type || null,
    data: await serializeFileData(file),
  });
}

export function listTransferFiles(transfer: DataTransfer | null) {
  return Array.from(transfer?.files ?? []);
}
