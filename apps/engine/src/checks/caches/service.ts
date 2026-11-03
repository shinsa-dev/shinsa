import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Context, Duration, Effect, Layer } from 'effect';
import { CACHES_DIR, TURBO_CACHE, TURBO_CONFIG, UNUSED_CACHE } from '../schema.ts';

export class SharedCaches extends Context.Service<
  SharedCaches,
  {
    resolvePath(dataDir: string, repoId: string): string;
    resolveEnv(checkout: string, dataDir: string, repoId: string): Effect.Effect<Record<string, string>>;
    prune(dataDir: string, repoIds: readonly string[], now: number): Effect.Effect<void>;
  }
>()('shinsa/engine/checks/caches/SharedCaches') {
  static readonly layer = Layer.sync(SharedCaches, () => {
    const resolvePath = (dataDir: string, repoId: string) => join(dataDir, CACHES_DIR, repoId);

    const listEntries = (dir: string) =>
      existsSync(dir) ? readdirSync(dir).filter((name) => !name.startsWith('.')) : [];

    const resolveEnv = Effect.fn('SharedCaches.resolveEnv')(function* (
      checkout: string,
      dataDir: string,
      repoId: string
    ): Effect.fn.Return<Record<string, string>> {
      const turbo = yield* Effect.sync(() => existsSync(join(checkout, TURBO_CONFIG)));
      if (!turbo) return {};
      return { TURBO_CACHE_DIR: join(resolvePath(dataDir, repoId), TURBO_CACHE) };
    });

    const prune = Effect.fn('SharedCaches.prune')(function* (
      dataDir: string,
      repoIds: readonly string[],
      now: number
    ) {
      const known = new Set(repoIds);
      const unused = Duration.toMillis(UNUSED_CACHE);
      yield* Effect.sync(() => {
        for (const repoId of listEntries(join(dataDir, CACHES_DIR))) {
          const path = resolvePath(dataDir, repoId);
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

    return SharedCaches.of({ resolvePath, resolveEnv, prune });
  });
}
