import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Context, Duration, Effect, Layer } from 'effect';
import { CACHES_DIR, TURBO_CACHE, UNUSED_CACHE } from '../schema.ts';
import { resolveRepoCachePath } from './paths.ts';

export class SharedCaches extends Context.Service<
  SharedCaches,
  { prune(dataDir: string, repoIds: readonly string[], now: number): Effect.Effect<void> }
>()('shinsa/engine/checks/caches/SharedCaches') {
  static readonly layer = Layer.sync(SharedCaches, () => {
    const listEntries = (dir: string) =>
      existsSync(dir) ? readdirSync(dir).filter((name) => !name.startsWith('.')) : [];

    const prune = Effect.fn('SharedCaches.prune')(function* (
      dataDir: string,
      repoIds: readonly string[],
      now: number
    ) {
      const known = new Set(repoIds);
      const unused = Duration.toMillis(UNUSED_CACHE);
      yield* Effect.sync(() => {
        for (const repoId of listEntries(join(dataDir, CACHES_DIR))) {
          const path = resolveRepoCachePath(dataDir, repoId);
          if (!known.has(repoId)) {
            rmSync(path, { recursive: true, force: true });
            continue;
          }
          const turbo = join(path, TURBO_CACHE);
          for (const name of listEntries(turbo)) {
            const entry = join(turbo, name);
            if (now - statSync(entry).mtimeMs > unused) rmSync(entry, { recursive: true, force: true });
          }
        }
      });
    });

    return SharedCaches.of({ prune });
  });
}
