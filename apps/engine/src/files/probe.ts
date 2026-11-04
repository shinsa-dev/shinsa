import { Effect, FileSystem, Option } from 'effect';

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
