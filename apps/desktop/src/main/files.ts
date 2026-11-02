import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { Effect, Layer } from 'effect';
import { type FileEntry, FileWriteFailed } from '../files/schema.ts';
import { Files } from '../files/service.ts';

const writing = (path: string, write: () => void) =>
  Effect.try({ try: write, catch: (cause) => new FileWriteFailed({ path, message: String(cause) }) });

export const FilesLive = Layer.succeed(
  Files,
  Files.of({
    readText: (path) => Effect.option(Effect.try(() => readFileSync(path, 'utf8'))),
    readSize: (path) => Effect.option(Effect.try(() => statSync(path).size)),
    exists: (path) => Effect.sync(() => existsSync(path)),
    readEntry: (path) =>
      Effect.try((): FileEntry => {
        if (!lstatSync(path).isSymbolicLink()) return { kind: 'file' };
        return { kind: 'link', target: readlinkSync(path) };
      }).pipe(Effect.orElseSucceed((): FileEntry => ({ kind: 'missing' }))),
    link: (target, path) =>
      writing(path, () => {
        mkdirSync(dirname(path), { recursive: true });
        symlinkSync(target, path);
      }),
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
