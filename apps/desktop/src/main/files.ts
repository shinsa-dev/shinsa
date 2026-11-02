import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { Effect, Layer } from 'effect';
import { FileWriteFailed } from '../files/schema.ts';
import { Files } from '../files/service.ts';

const writing = (path: string, write: () => void) =>
  Effect.try({ try: write, catch: (cause) => new FileWriteFailed({ path, message: String(cause) }) });

export const FilesLive = Layer.succeed(
  Files,
  Files.of({
    readText: (path) => Effect.option(Effect.try(() => readFileSync(path, 'utf8'))),
    readSize: (path) => Effect.option(Effect.try(() => statSync(path).size)),
    exists: (path) => Effect.sync(() => existsSync(path)),
    writeText: (path, text) =>
      writing(path, () => {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, text);
      }),
    appendText: (path, text) =>
      writing(path, () => {
        mkdirSync(dirname(path), { recursive: true });
        appendFileSync(path, text);
      }),
    rename: (from, to) => writing(from, () => renameSync(from, to)),
    remove: (path) => Effect.ignore(Effect.try(() => rmSync(path, { recursive: true, force: true }))),
  })
);
