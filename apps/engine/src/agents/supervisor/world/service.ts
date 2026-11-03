import {
  type ChatEvent,
  DomainError,
  type ShinsaCommand,
  type ShinsaEvent,
  type ShinsaState,
} from '@shinsa/core';
import { Context, Effect, Layer } from 'effect';
import type { ServerConfig } from '../../../config/index.ts';
import { describeError } from '../../../log/index.ts';
import type { Engine } from '../../../runtime/engine.ts';
import type { DispatchOptions } from '../../../runtime/engine/schema.ts';
import type { WorktreeRoot } from '../../../workspaces/index.ts';
import type { AccountLeasing } from '../../accounts.ts';
import type { ProviderRegistry } from '../../providers/index.ts';
import type { Transcripts } from '../../transcripts/index.ts';
import { RunDispatchFailed } from '../schema.ts';

export class RunWorld extends Context.Service<
  RunWorld,
  {
    readonly config: ServerConfig;
    readonly worktreeRoot: WorktreeRoot;
    readonly transcripts: Transcripts;
    readonly providers: ProviderRegistry;
    readonly leasing: AccountLeasing;
    readonly state: Effect.Effect<ShinsaState>;
    dispatch(
      command: ShinsaCommand,
      options?: DispatchOptions
    ): Effect.Effect<ShinsaEvent[], DomainError | RunDispatchFailed>;
    recordEntry(runId: string, entry: ChatEvent): Effect.Effect<void>;
  }
>()('shinsa/engine/agents/supervisor/world/RunWorld') {
  static layer(world: {
    engine: Engine;
    config: ServerConfig;
    worktreeRoot: WorktreeRoot;
    transcripts: Transcripts;
    providers: ProviderRegistry;
    leasing: AccountLeasing;
    recordEntry: (runId: string, entry: ChatEvent) => void;
  }) {
    return Layer.succeed(
      RunWorld,
      RunWorld.of({
        config: world.config,
        worktreeRoot: world.worktreeRoot,
        transcripts: world.transcripts,
        providers: world.providers,
        leasing: world.leasing,
        state: Effect.sync(() => world.engine.state),
        dispatch: (command, options) =>
          Effect.tryPromise({
            try: () => world.engine.dispatch(command, options),
            catch: (error) =>
              error instanceof DomainError ? error : new RunDispatchFailed({ message: describeError(error) }),
          }),
        recordEntry: (runId, entry) => Effect.sync(() => world.recordEntry(runId, entry)),
      })
    );
  }
}
