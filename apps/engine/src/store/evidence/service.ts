import { extname, join } from 'node:path';
import { Context, Effect, FileSystem, Layer, Option } from 'effect';
import type { PlatformError } from 'effect/PlatformError';
import { EngineConfig } from '../../config/service.ts';
import { isEvidencePath, resolveFolderPath } from './folder.ts';
import { writeImageFile } from './image-file.ts';
import {
  EVIDENCE_COPY_LIMIT_BYTES,
  EVIDENCE_ROUTE,
  type EvidenceFolder,
  type EvidenceFolderInvalid,
  EvidenceSourceMissing,
  EvidenceTooLarge,
  MEGABYTE,
  NAME_ID_LENGTH,
  SLUG_LIMIT,
  type TextExtension,
} from './schema.ts';

export class Evidence extends Context.Service<
  Evidence,
  {
    writeImage(base64: string, mediaType: string): Effect.Effect<string>;
    writeText(
      text: string,
      folder: EvidenceFolder,
      title: string,
      extension: TextExtension
    ): Effect.Effect<string, EvidenceFolderInvalid>;
    copyFile(
      source: string,
      folder: EvidenceFolder,
      title: string
    ): Effect.Effect<string, EvidenceFolderInvalid | EvidenceSourceMissing | EvidenceTooLarge>;
    selectFile(name: string): Effect.Effect<Option.Option<string>>;
  }
>()('shinsa/engine/store/evidence/Evidence') {
  static readonly layer = Layer.effect(
    Evidence,
    Effect.gen(function* () {
      const dir = (yield* EngineConfig).evidenceDir;
      const fs = yield* FileSystem.FileSystem;
      const statFile = (path: string) =>
        fs.stat(path).pipe(
          Effect.map((info) => (info.type === 'File' ? Option.some(info) : Option.none())),
          Effect.orElseSucceed(() => Option.none<FileSystem.File.Info>())
        );

      const resolveExtension = (text: string, fallback: string) => {
        const extension = text
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '')
          .slice(0, 8);
        return extension || fallback;
      };

      const resolveSlug = (title: string) => {
        const slug = title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+/, '')
          .slice(0, SLUG_LIMIT)
          .replace(/-+$/, '');
        return slug || 'evidence';
      };

      const writeEvidence = Effect.fn('Evidence.writeEvidence')(function* (
        folder: string | null,
        base: string,
        extension: string,
        write: (path: string) => Effect.Effect<void, PlatformError>
      ) {
        const id = Bun.randomUUIDv7().replace(/-/g, '').slice(-NAME_ID_LENGTH);
        const name = `${base}${id}.${extension}`;
        const relative = folder ? `${folder}/${name}` : name;
        if (folder) yield* fs.makeDirectory(join(dir, folder), { recursive: true }).pipe(Effect.orDie);
        yield* write(join(dir, relative)).pipe(Effect.orDie);
        return `${EVIDENCE_ROUTE}${relative}`;
      });

      return Evidence.of({
        writeImage: (base64, mediaType) =>
          Effect.suspend(() => {
            const extension = resolveExtension(mediaType.split('/')[1] ?? '', 'png');
            return writeEvidence(null, '', extension, (path) =>
              Effect.sync(() => writeImageFile(path, base64))
            );
          }),
        writeText: Effect.fn('Evidence.writeText')(function* (text, folder, title, extension) {
          const path = yield* resolveFolderPath(folder);
          return yield* writeEvidence(path, `${resolveSlug(title)}-`, extension, (file) =>
            fs.writeFileString(file, text)
          );
        }),
        copyFile: Effect.fn('Evidence.copyFile')(function* (source, folder, title) {
          const found = yield* statFile(source);
          if (Option.isNone(found))
            return yield* new EvidenceSourceMissing({ source, message: `No file at ${source}.` });
          const size = Number(found.value.size);
          if (size > EVIDENCE_COPY_LIMIT_BYTES) {
            return yield* new EvidenceTooLarge({
              source,
              size,
              message: `${source} is ${Math.ceil(size / MEGABYTE)} MB; the limit is ${EVIDENCE_COPY_LIMIT_BYTES / MEGABYTE} MB. Record a shorter clip or a smaller window.`,
            });
          }
          const path = yield* resolveFolderPath(folder);
          const extension = resolveExtension(extname(source), 'bin');
          return yield* writeEvidence(path, `${resolveSlug(title)}-`, extension, (file) =>
            fs.copyFile(source, file)
          );
        }),
        selectFile: Effect.fn('Evidence.selectFile')(function* (name) {
          const segments = name.split('/');
          if (!isEvidencePath(segments)) return Option.none<string>();
          const path = join(dir, ...segments);
          return Option.map(yield* statFile(path), () => path);
        }),
      });
    })
  );
}
