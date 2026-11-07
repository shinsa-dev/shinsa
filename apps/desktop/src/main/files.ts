import { dirname } from 'node:path';
import { Effect, FileSystem, Layer, type PlatformError } from 'effect';
import { type FileEntry, FileWriteFailed } from '../files/schema.ts';
import { Files } from '../files/service.ts';

export const FilesLive = Layer.effect(
  Files,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const failWrite = (path: string) => (error: PlatformError.PlatformError) =>
      new FileWriteFailed({ path, message: error.message });
    const writeBeside = (path: string, write: Effect.Effect<void, PlatformError.PlatformError>) =>
      fs
        .makeDirectory(dirname(path), { recursive: true })
        .pipe(Effect.andThen(write), Effect.mapError(failWrite(path)));

    return Files.of({
      readText: (path) => Effect.option(fs.readFileString(path)),
      readSize: (path) => Effect.option(Effect.map(fs.stat(path), (info) => Number(info.size))),
      exists: (path) => Effect.orElseSucceed(fs.exists(path), () => false),
      readEntry: (path) =>
        fs.lstat(path).pipe(
          Effect.flatMap((info): Effect.Effect<FileEntry, PlatformError.PlatformError> =>
            info.type === 'SymbolicLink'
              ? Effect.map(fs.readLink(path), (target) => ({ kind: 'link', target }))
              : Effect.succeed({ kind: 'file' })
          ),
          Effect.orElseSucceed((): FileEntry => ({ kind: 'missing' }))
        ),
      link: (target, path) => writeBeside(path, fs.symlink(target, path)),
      writeText: (path, text) => writeBeside(path, fs.writeFileString(path, text)),
      appendText: (path, text) => writeBeside(path, fs.writeFileString(path, text, { flag: 'a' })),
      rename: (from, to) => fs.rename(from, to).pipe(Effect.mapError(failWrite(from))),
      remove: (path) => Effect.ignore(fs.remove(path, { recursive: true, force: true })),
    });
  })
);
