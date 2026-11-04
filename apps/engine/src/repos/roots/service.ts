import { Clock, Context, Effect, Layer, SynchronizedRef } from 'effect';
import { EngineConfig } from '../../config/service.ts';
import { ConfigStore } from '../../config/store/service.ts';
import { RepoFolders } from '../folders/service.ts';
import { DISCOVERY_TTL_MS, type Discovery, type RootSourceKind } from '../schema.ts';
import type { RootsDiscovery } from './schema.ts';

export class Roots extends Context.Service<
  Roots,
  {
    readonly fromEnvironment: string[];
    readonly configured: Effect.Effect<string[]>;
    readonly kind: Effect.Effect<RootSourceKind>;
    discover(force: boolean): Effect.Effect<Discovery>;
    readonly listRoots: Effect.Effect<string[]>;
  }
>()('shinsa/engine/repos/roots/Roots') {
  static readonly layer = Layer.effect(
    Roots,
    Effect.gen(function* () {
      const { roots: fromEnvironment, userHome: home } = yield* EngineConfig;
      const store = yield* ConfigStore;
      const folders = yield* RepoFolders;
      const discovery = yield* SynchronizedRef.make<RootsDiscovery | null>(null);
      const configured = Effect.map(store.config, (config) => [...config.roots]);

      const kind = Effect.map(configured, (roots): RootSourceKind => {
        if (roots.length > 0) return 'configured';
        if (fromEnvironment.length > 0) return 'environment';
        return 'discovered';
      });

      const refresh = Effect.fn('Roots.refresh')(function* (known: RootsDiscovery | null, force: boolean) {
        const now = yield* Clock.currentTimeMillis;
        if (!force && known && now - known.at <= DISCOVERY_TTL_MS) return known;
        const fresh: RootsDiscovery = { at: now, result: yield* Effect.cached(folders.discover(home)) };
        return fresh;
      });

      const discover = Effect.fn('Roots.discover')(function* (force: boolean) {
        const result = yield* SynchronizedRef.modifyEffect(discovery, (known) =>
          Effect.map(refresh(known, force), (fresh) => [fresh.result, fresh] as const)
        );
        return yield* result;
      });

      const listRoots = Effect.gen(function* () {
        const explicit = [...new Set([...fromEnvironment, ...(yield* configured)])];
        if (explicit.length > 0) return explicit;
        const { candidates } = yield* discover(false);
        return candidates.map((candidate) => candidate.path);
      });

      return Roots.of({ fromEnvironment: [...fromEnvironment], configured, kind, discover, listRoots });
    })
  );
}
