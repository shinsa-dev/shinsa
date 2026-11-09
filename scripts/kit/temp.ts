import { Effect, FileSystem } from 'effect';

export const createTempDirectory = Effect.fn('createTempDirectory')(function* (prefix: string) {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.makeTempDirectoryScoped({ prefix }).pipe(Effect.orDie);
});
