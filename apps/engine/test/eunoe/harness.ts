import type { CoreConfig } from '@chroxify/eunoe';
import { BunServices } from '@effect/platform-bun';
import type { ChatNotice } from '@shinsa/core';
import { Context, Effect, Exit, Layer, Scope } from 'effect';
import { EngineConfig } from '../../src/config/service.ts';
import { EunoeSettings, type EunoeSettingsShape } from '../../src/eunoe/schema.ts';
import { EunoeServer } from '../../src/eunoe/service.ts';
import { JsonLogger } from '../../src/log/service.ts';
import { createConfigAt } from '../helpers/config.ts';
import { createTempDir } from '../helpers/temp.ts';

export interface EunoeOptions extends Partial<Omit<EunoeSettingsShape, 'config'>> {
  tuning?: Partial<CoreConfig>;
}

function createEunoeLayer(options: EunoeOptions = {}, root = createTempDir()) {
  const { tuning, ...given } = options;
  const defaults = EunoeSettings.defaultValue();
  const settings: EunoeSettingsShape = { ...defaults, ...given, config: { ...defaults.config, ...tuning } };
  return EunoeServer.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(EngineConfig, createConfigAt(root)),
        Layer.succeed(EunoeSettings, settings),
        BunServices.layer
      )
    )
  );
}

export function openEunoe(options: EunoeOptions = {}, root = createTempDir()) {
  const scope = Scope.makeUnsafe();
  const server = Effect.runSync(
    Layer.buildWithScope(createEunoeLayer(options, root), scope).pipe(
      Effect.map((context) => Context.get(context, EunoeServer)),
      Effect.provide(JsonLogger)
    )
  );
  const run = <A>(effect: Effect.Effect<A>) => Effect.runPromise(effect.pipe(Effect.provide(JsonLogger)));
  return {
    server,
    dir: server.dir,
    ensure: () => run(server.ensure),
    fold: (sessionId: string, warm: boolean) => {
      const release = Effect.runSync(server.fold(sessionId, warm));
      return () => Effect.runSync(release);
    },
    watch: (sessionId: string) => {
      const notices: ChatNotice[] = [];
      const stuck: string[] = [];
      const unwatch = Effect.runSync(
        server.watch(sessionId, {
          notice: (notice) => notices.push(notice),
          stuck: () => stuck.push(sessionId),
        })
      );
      return { notices, stuck, stop: () => Effect.runSync(unwatch) };
    },
    stop: () => run(server.stop),
    close: () => run(Scope.close(scope, Exit.void)),
  };
}

export type OpenEunoe = ReturnType<typeof openEunoe>;
