import { join } from 'node:path';
import { Context, Duration, Effect, FileSystem, Layer, Option } from 'effect';
import type { PlatformError } from 'effect/PlatformError';
import { CACHES_DIR, TURBO_CACHE, UNUSED_CACHE } from '../schema.ts';
import { resolveRepoCachePath } from './paths.ts';

export class SharedCaches extends Context.Service<
  SharedCaches,
  { prune(dataDir: string, repoIds: readonly string[], now: number): Effect.Effect<void, PlatformError> }
>()('shinsa/engine/checks/caches/SharedCaches') {
  static readonly layer = Layer.effect(
    SharedCaches,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const unused = Duration.toMillis(UNUSED_CACHE);

      const listEntries = Effect.fn('SharedCaches.listEntries')(function* (dir: string) {
        if (!(yield* fs.exists(dir))) return [];
        return (yield* fs.readDirectory(dir)).filter((name) => !name.startsWith('.'));
      });

      const remove = (path: string) => fs.remove(path, { recursive: true, force: true });

      const pruneTurbo = Effect.fn('SharedCaches.pruneTurbo')(function* (turbo: string, now: number) {
        for (const name of yield* listEntries(turbo)) {
          const entry = join(turbo, name);
          const modified = Option.getOrUndefined((yield* fs.stat(entry)).mtime)?.getTime() ?? now;
          if (now - modified > unused) yield* remove(entry);
        }
      });

      const prune = Effect.fn('SharedCaches.prune')(function* (
        dataDir: string,
        repoIds: readonly string[],
        now: number
      ) {
        const known = new Set(repoIds);
        for (const repoId of yield* listEntries(join(dataDir, CACHES_DIR))) {
          const path = resolveRepoCachePath(dataDir, repoId);
          if (known.has(repoId)) yield* pruneTurbo(join(path, TURBO_CACHE), now);
          else yield* remove(path);
        }
      });

      return SharedCaches.of({ prune });
    })
  );
}
