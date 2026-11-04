import { Clock, Context, Duration, Effect, Layer, Option, Ref } from 'effect';
import { EngineConfig } from '../../config/service.ts';
import { NOT_STARTED_EXIT_CODE } from '../../shell/schema.ts';
import { parseCswapList } from '../answers.ts';
import { AccountCommands } from '../command/service.ts';
import { CSWAP_BINARIES, CSWAP_LIST_TTL, CSWAP_TIMEOUT, type CswapAccount } from '../schema.ts';
import type { CswapListing } from './schema.ts';

export class Cswap extends Context.Service<Cswap, { readonly list: Effect.Effect<CswapAccount[]> }>()(
  'shinsa/engine/accounts/cswap/Cswap'
) {
  static readonly layer = Layer.effect(
    Cswap,
    Effect.gen(function* () {
      const commands = yield* AccountCommands;
      const { userHome } = yield* EngineConfig;
      const listed = yield* Ref.make(Option.none<CswapListing>());
      const ttl = Duration.toMillis(CSWAP_LIST_TTL);

      const runList = Effect.gen(function* () {
        for (const binary of CSWAP_BINARIES) {
          const result = yield* commands.run([binary, 'list', '--json'], userHome, {
            timeout: CSWAP_TIMEOUT,
          });
          if (result.code !== NOT_STARTED_EXIT_CODE) return Option.some(result);
        }
        return Option.none();
      });

      const list = Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const cached = yield* Ref.get(listed);
        if (Option.isSome(cached) && now - cached.value.at < ttl) return cached.value.accounts;
        const result = yield* runList;
        if (Option.isNone(result)) return [];
        const accounts = result.value.ok ? parseCswapList(result.value.stdout) : [];
        if (!result.value.ok)
          yield* Effect.logWarning('[Accounts] claude-swap did not list its accounts').pipe(
            Effect.annotateLogs({ code: result.value.code })
          );
        yield* Ref.set(listed, Option.some({ at: now, accounts }));
        return accounts;
      });

      return Cswap.of({ list });
    })
  );
}
