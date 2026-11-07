import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { Context, Effect, Layer, Option } from 'effect';
import { EngineConfig } from '../../config/service.ts';
import { isEvidencePath, resolveFolderPath } from './folder.ts';
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
        write: (path: string) => Effect.Effect<void>
      ) {
        const id = Bun.randomUUIDv7().replace(/-/g, '').slice(-NAME_ID_LENGTH);
        const name = `${base}${id}.${extension}`;
        const relative = folder ? `${folder}/${name}` : name;
        if (folder) yield* Effect.sync(() => mkdirSync(join(dir, folder), { recursive: true }));
        yield* write(join(dir, relative));
        return `${EVIDENCE_ROUTE}${relative}`;
      });

      return Evidence.of({
        writeImage: (base64, mediaType) =>
          Effect.suspend(() => {
            const extension = resolveExtension(mediaType.split('/')[1] ?? '', 'png');
            return writeEvidence(null, '', extension, (path) =>
              Effect.sync(() => writeFileSync(path, Buffer.from(base64, 'base64')))
            );
          }),
        writeText: Effect.fn('Evidence.writeText')(function* (text, folder, title, extension) {
          const path = yield* resolveFolderPath(folder);
          return yield* writeEvidence(path, `${resolveSlug(title)}-`, extension, (file) =>
            Effect.sync(() => writeFileSync(file, text))
          );
        }),
        copyFile: Effect.fn('Evidence.copyFile')(function* (source, folder, title) {
          const stats = yield* Effect.sync(() => (existsSync(source) ? statSync(source) : null));
          if (!stats?.isFile())
            return yield* new EvidenceSourceMissing({ source, message: `No file at ${source}.` });
          if (stats.size > EVIDENCE_COPY_LIMIT_BYTES) {
            return yield* new EvidenceTooLarge({
              source,
              size: stats.size,
              message: `${source} is ${Math.ceil(stats.size / MEGABYTE)} MB; the limit is ${EVIDENCE_COPY_LIMIT_BYTES / MEGABYTE} MB. Record a shorter clip or a smaller window.`,
            });
          }
          const path = yield* resolveFolderPath(folder);
          const extension = resolveExtension(extname(source), 'bin');
          return yield* writeEvidence(path, `${resolveSlug(title)}-`, extension, (file) =>
            Effect.sync(() => copyFileSync(source, file))
          );
        }),
        selectFile: (name) =>
          Effect.sync(() => {
            const segments = name.split('/');
            if (!isEvidencePath(segments)) return Option.none();
            const path = join(dir, ...segments);
            return existsSync(path) && statSync(path).isFile() ? Option.some(path) : Option.none();
          }),
      });
    })
  );
}
