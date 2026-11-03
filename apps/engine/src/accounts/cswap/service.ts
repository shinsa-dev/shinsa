import { Effect, Option, Ref } from 'effect';
import { parseCswapList } from '../answers.ts';
import { CSWAP_BINARIES, CSWAP_LIST_TTL_MS, CSWAP_TIMEOUT_MS } from '../schema.ts';
import type { CswapDefinition, CswapHandle, CswapListing } from './schema.ts';

export const makeCswap = Effect.fn('Cswap.make')(function* (definition: CswapDefinition) {
  const listed = yield* Ref.make(Option.none<CswapListing>());

  const resolveBinary = Effect.gen(function* () {
    for (const name of CSWAP_BINARIES) {
      const path = yield* definition.which(name);
      if (path) return path;
    }
    return null;
  });

  const list = Effect.gen(function* () {
    const now = yield* definition.now;
    const cached = yield* Ref.get(listed);
    if (Option.isSome(cached) && now - cached.value.at < CSWAP_LIST_TTL_MS) return cached.value.accounts;
    const binary = yield* resolveBinary;
    if (!binary) return [];
    const result = yield* definition.run([binary, 'list', '--json'], definition.home, {
      timeoutMs: CSWAP_TIMEOUT_MS,
    });
    const accounts = result.ok ? parseCswapList(result.stdout) : [];
    if (!result.ok)
      yield* Effect.logWarning('[Accounts] claude-swap did not list its accounts').pipe(
        Effect.annotateLogs({ code: result.code })
      );
    yield* Ref.set(listed, Option.some({ at: now, accounts }));
    return accounts;
  });

  const handle: CswapHandle = { list };
  return handle;
});
