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

const failWrite = (path: string) => (cause: unknown) => new FileWriteFailed({ path, message: String(cause) });

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
      Effect.try({
        try: () => {
          mkdirSync(dirname(path), { recursive: true });
          symlinkSync(target, path);
        },
        catch: failWrite(path),
      }),
    writeText: (path, text) =>
      Effect.try({
        try: () => {
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, text);
        },
        catch: failWrite(path),
      }),
    appendText: (path, text) =>
      Effect.try({
        try: () => {
          mkdirSync(dirname(path), { recursive: true });
          appendFileSync(path, text);
        },
        catch: failWrite(path),
      }),
    rename: (from, to) => Effect.try({ try: () => renameSync(from, to), catch: failWrite(from) }),
    remove: (path) => Effect.ignore(Effect.try(() => rmSync(path, { recursive: true, force: true }))),
  })
);
