import {
  type ChatEvent,
  DomainError,
  type ShinsaCommand,
  type ShinsaEvent,
  type ShinsaState,
} from '@shinsa/core';
import { Context, Effect, Layer } from 'effect';
import type { ServerConfig } from '../../../config/index.ts';
import { EngineConfig } from '../../../config/service.ts';
import { Checkout } from '../../../git/checkout/service.ts';
import { describeError } from '../../../log/index.ts';
import type { DispatchOptions } from '../../../runtime/engine/schema.ts';
import { EngineCore } from '../../../runtime/engine/service.ts';
import { WorktreeRoot } from '../../../workspaces/root/service.ts';
import { AccountLeasing } from '../../accounts/service.ts';
import { Providers } from '../../providers/index.ts';
import { Transcripts } from '../../transcripts/service.ts';
import { RunDispatchFailed, RunHooks } from '../schema.ts';

export class RunWorld extends Context.Service<
  RunWorld,
  {
    readonly config: ServerConfig;
    readonly worktreeRoot: WorktreeRoot['Service'];
    readonly transcripts: Transcripts['Service'];
    readonly providers: Providers['Service'];
    readonly leasing: AccountLeasing['Service'];
    readonly checkout: Checkout['Service'];
    readonly state: Effect.Effect<ShinsaState>;
    dispatch(
      command: ShinsaCommand,
      options?: DispatchOptions
    ): Effect.Effect<ShinsaEvent[], DomainError | RunDispatchFailed>;
    recordEntry(runId: string, entry: ChatEvent): Effect.Effect<void>;
  }
>()('shinsa/engine/agents/supervisor/world/RunWorld') {
  static readonly layer = Layer.effect(
    RunWorld,
    Effect.gen(function* () {
      const engine = yield* EngineCore;
      const config = yield* EngineConfig;
      const worktreeRoot = yield* WorktreeRoot;
      const transcripts = yield* Transcripts;
      const providers = yield* Providers;
      const leasing = yield* AccountLeasing;
      const checkout = yield* Checkout;
      const { onNotice } = yield* RunHooks;

      const recordEntry = Effect.fn('RunWorld.recordEntry')(function* (runId: string, entry: ChatEvent) {
        yield* transcripts.record(runId, entry);
        if (entry.type === 'notice' && onNotice) yield* onNotice(runId, entry.notice);
      });

      return RunWorld.of({
        config,
        worktreeRoot,
        transcripts,
        providers,
        leasing,
        checkout,
        state: engine.state,
        dispatch: (command, options) =>
          engine
            .dispatch(command, options)
            .pipe(
              Effect.mapError((error) =>
                error instanceof DomainError
                  ? error
                  : new RunDispatchFailed({ message: describeError(error) })
              )
            ),
        recordEntry,
      });
    })
  );
}
