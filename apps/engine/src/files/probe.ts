import { delimiter, join } from 'node:path';
import { Effect, FileSystem, Option } from 'effect';
import { EXECUTABLE_BITS } from './schema.ts';

export const isPresent = Effect.fn('Files.isPresent')(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.exists(path).pipe(Effect.orElseSucceed(() => false));
});

export const isFolder = Effect.fn('Files.isFolder')(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.stat(path).pipe(
    Effect.map((info) => info.type === 'Directory'),
    Effect.orElseSucceed(() => false)
  );
});

export const isFile = Effect.fn('Files.isFile')(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.stat(path).pipe(
    Effect.map((info) => info.type === 'File'),
    Effect.orElseSucceed(() => false)
  );
});

export const selectText = Effect.fn('Files.selectText')(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  return yield* Effect.option(fs.readFileString(path));
});

export const selectRealPath = Effect.fn('Files.selectRealPath')(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  return yield* Effect.option(fs.realPath(path));
});

export const listEntries = Effect.fn('Files.listEntries')(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.readDirectory(path).pipe(
    Effect.map((names) => [...names].sort()),
    Effect.orElseSucceed((): string[] => [])
  );
});

export const findFirstPresent = Effect.fn('Files.findFirstPresent')(function* (paths: readonly string[]) {
  for (const path of paths) if (yield* isPresent(path)) return Option.some(path);
  return Option.none<string>();
});

export const isExecutable = Effect.fn('Files.isExecutable')(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.stat(path).pipe(
    Effect.map((info) => info.type === 'File' && (info.mode & EXECUTABLE_BITS) !== 0),
    Effect.orElseSucceed(() => false)
  );
});

export const selectOnPath = Effect.fn('Files.selectOnPath')(function* (command: string, path: string) {
  if (command.includes('/'))
    return (yield* isExecutable(command)) ? Option.some(command) : Option.none<string>();
  for (const dir of path.split(delimiter).filter(Boolean)) {
    const candidate = join(dir, command);
    if (yield* isExecutable(candidate)) return Option.some(candidate);
  }
  return Option.none<string>();
});
