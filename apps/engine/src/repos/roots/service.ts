import { Clock, Effect, SynchronizedRef } from 'effect';
import { RepoFolders } from '../folders/service.ts';
import { DISCOVERY_TTL_MS } from '../schema.ts';
import type { RootsDefinition, RootsDiscovery, RootsHandle } from './schema.ts';

export const makeRoots = Effect.fn('Roots.make')(function* (definition: RootsDefinition) {
  const folders = yield* RepoFolders;
  const discoverHome = definition.discover ?? ((home: string) => folders.discover(home));
  const discovery = yield* SynchronizedRef.make<RootsDiscovery | null>(null);

  const refresh = Effect.fn('Roots.refresh')(function* (known: RootsDiscovery | null, force: boolean) {
    const now = yield* Clock.currentTimeMillis;
    if (!force && known && now - known.at <= DISCOVERY_TTL_MS) return known;
    const fresh: RootsDiscovery = { at: now, result: yield* Effect.cached(discoverHome(definition.home)) };
    return fresh;
  });

  const discover = Effect.fn('Roots.discover')(function* (force: boolean) {
    const result = yield* SynchronizedRef.modifyEffect(discovery, (known) =>
      Effect.map(refresh(known, force), (fresh) => [fresh.result, fresh] as const)
    );
    return yield* result;
  });

  const listRoots = Effect.gen(function* () {
    const explicit = [...new Set([...definition.fromEnvironment, ...(yield* definition.configured)])];
    if (explicit.length > 0) return explicit;
    const { candidates } = yield* discover(false);
    return candidates.map((candidate) => candidate.path);
  });

  const handle: RootsHandle = { discover, listRoots };
  return handle;
});
