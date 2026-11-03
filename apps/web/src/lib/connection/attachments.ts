import { Effect } from 'effect';
import { runApp } from '@/lib/runtime/app.ts';
import { decodeAnswer } from '@/lib/runtime/engine/answers.ts';
import { EngineClient } from '@/lib/runtime/engine/service.ts';
import { FILE_UNREADABLE_MESSAGE, FileUnreadable, StoredAttachmentAnswer } from './schema.ts';

export const ATTACHMENT_COUNT_LIMIT = 10;

export const ATTACHMENT_SIZE_LIMIT = 25 * 1024 * 1024;

const CHUNK = 0x8000;

const decodeStored = decodeAnswer(StoredAttachmentAnswer);

const encodeFile = Effect.fn('Attachments.encode')(function* (file: Blob) {
  const buffer = yield* Effect.tryPromise({
    try: () => file.arrayBuffer(),
    catch: () => new FileUnreadable({ message: FILE_UNREADABLE_MESSAGE }),
  });
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let start = 0; start < bytes.length; start += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(start, start + CHUNK));
  }
  return btoa(binary);
});

const upload = Effect.fn('Attachments.upload')(function* (file: File) {
  const engine = yield* EngineClient;
  const data = yield* encodeFile(file);
  const stored = yield* engine.files.uploadAttachment({
    payload: { name: file.name || 'Pasted image', mimeType: file.type || null, data },
  });
  return yield* decodeStored(stored);
});

export function serializeFileData(file: Blob) {
  return runApp(encodeFile(file));
}

export function requestAttachmentUpload(file: File) {
  return runApp(upload(file));
}

export function listTransferFiles(transfer: DataTransfer | null) {
  return Array.from(transfer?.files ?? []);
}
