import { basename } from 'node:path';
import { EngineApi } from '@shinsa/core/engine-api';
import { FileNotFound } from '@shinsa/core/engine-api/schema';
import { Effect, Layer } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { EngineConfig } from '../../../config/service.ts';
import { Attachments } from '../../../store/attachments/service.ts';
import { parseAttachmentUpload } from '../../../store/attachments/upload.ts';
import { Evidence } from '../../../store/evidence/service.ts';
import { resolveRequestFailure } from '../../failures.ts';
import { resolveAttachmentHeaders, respondFile } from '../../files.ts';

export const FilesHandlers = HttpApiBuilder.group(
  EngineApi,
  'files',
  Effect.fn('FilesHandlers')(function* (handlers) {
    const config = yield* EngineConfig;
    const evidence = yield* Evidence;
    const attachments = yield* Attachments.use(Effect.succeed).pipe(
      Effect.provide(Attachments.layer.pipe(Layer.provide(Layer.succeed(EngineConfig, config))))
    );

    return handlers
      .handle(
        'evidence',
        Effect.fn('FilesHandlers.evidence')(function* ({ params, request }) {
          const path = yield* evidence.selectFile(params['*']);
          if (path._tag === 'None') return yield* new FileNotFound();
          return respondFile(yield* Effect.sync(() => Bun.file(path.value)), request.headers.range);
        })
      )
      .handle('uploadAttachment', ({ payload }) =>
        Effect.flatMap(parseAttachmentUpload(payload), attachments.write).pipe(
          Effect.mapError(resolveRequestFailure)
        )
      )
      .handle(
        'attachment',
        Effect.fn('FilesHandlers.attachment')(function* ({ params, request }) {
          const found = yield* attachments.selectFile(params['*']);
          if (found._tag === 'None') return yield* new FileNotFound();
          const file = yield* Effect.sync(() => Bun.file(found.value));
          const headers = resolveAttachmentHeaders(file.type, basename(found.value));
          return respondFile(file, request.headers.range, headers);
        })
      );
  })
);
