import { DomainError } from '@shinsa/core';
import { Effect, Schema } from 'effect';
import {
  AttachmentData,
  AttachmentMimeType,
  AttachmentName,
  type AttachmentUpload,
  DATA_INVALID,
  NAME_INVALID,
  TYPE_INVALID,
} from './schema.ts';

const decodeName = Schema.decodeUnknownEffect(AttachmentName);

const decodeMimeType = Schema.decodeUnknownEffect(Schema.Struct({ mimeType: AttachmentMimeType }));

const decodeData = Schema.decodeUnknownEffect(AttachmentData);

export const parseAttachmentUpload = Effect.fn('parseAttachmentUpload')(function* (
  body: Record<string, unknown>
) {
  const name = yield* decodeName(body.name).pipe(Effect.mapError(() => new DomainError(NAME_INVALID)));
  const { mimeType } = yield* decodeMimeType(body).pipe(Effect.mapError(() => new DomainError(TYPE_INVALID)));
  const data = yield* decodeData(body.data).pipe(Effect.mapError(() => new DomainError(DATA_INVALID)));
  return { name, mimeType: mimeType ?? null, data } satisfies AttachmentUpload;
});
