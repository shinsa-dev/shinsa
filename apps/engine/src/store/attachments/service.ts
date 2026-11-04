import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DomainError, type StoredAttachment } from '@shinsa/core';
import { Context, Effect, Layer, Option, Schema } from 'effect';
import { EngineConfig } from '../../config/service.ts';
import {
  ATTACHMENT_LIMIT_BYTES,
  ATTACHMENT_ROUTE,
  AttachmentFileName,
  AttachmentId,
  type AttachmentUpload,
  EMPTY,
  FILE_NAME_LIMIT,
  TOO_LARGE,
} from './schema.ts';

export class Attachments extends Context.Service<
  Attachments,
  {
    write(upload: AttachmentUpload): Effect.Effect<StoredAttachment, DomainError>;
    selectFile(name: string): Effect.Effect<Option.Option<string>>;
  }
>()('shinsa/engine/store/attachments/Attachments') {
  static readonly layer = Layer.effect(
    Attachments,
    Effect.gen(function* () {
      const dir = (yield* EngineConfig).attachmentsDir;
      const isId = Schema.is(AttachmentId);
      const isFileName = Schema.is(AttachmentFileName);

      const resolveFileName = (name: string) => {
        const [stem = '', extension = ''] = /^(.*?)((?:\.[A-Za-z0-9]{1,10})?)$/.exec(name)?.slice(1) ?? [];
        const safe = stem
          .replace(/[^\w-]+/g, '-')
          .replace(/^[-_]+|-+$/g, '')
          .slice(0, FILE_NAME_LIMIT);
        return `${safe || 'file'}${extension.toLowerCase()}`;
      };

      return Attachments.of({
        write: Effect.fn('Attachments.write')(function* (upload) {
          const bytes = Buffer.from(upload.data, 'base64');
          if (bytes.byteLength === 0) return yield* new DomainError(EMPTY);
          if (bytes.byteLength > ATTACHMENT_LIMIT_BYTES) return yield* new DomainError(TOO_LARGE);
          return yield* Effect.sync((): StoredAttachment => {
            const id = Bun.randomUUIDv7();
            const fileName = resolveFileName(upload.name);
            const folder = join(dir, id);
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
          });
        }),
        selectFile: (name) =>
          Effect.sync(() => {
            const [id = '', fileName = '', ...rest] = name.split('/');
            if (rest.length > 0 || !isId(id) || !isFileName(fileName)) return Option.none();
            const path = join(dir, id, fileName);
            return existsSync(path) && statSync(path).isFile() ? Option.some(path) : Option.none();
          }),
      });
    })
  );
}
