import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Effect, Layer } from 'effect';
import { FileWriteFailed } from '../files/schema.ts';
import { Files } from '../files/service.ts';

export const FilesLive = Layer.succeed(
  Files,
  Files.of({
    readText: (path) => Effect.option(Effect.try(() => readFileSync(path, 'utf8'))),
    exists: (path) => Effect.sync(() => existsSync(path)),
    writeText: (path, text) =>
      Effect.try({
        try: () => {
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, text);
        },
        catch: (cause) => new FileWriteFailed({ path, message: String(cause) }),
      }),
    remove: (path) => Effect.sync(() => rmSync(path, { force: true })),
  })
);
