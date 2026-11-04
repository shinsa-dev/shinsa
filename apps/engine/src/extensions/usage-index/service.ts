import { join } from 'node:path';
import { Cause, Clock, Context, Deferred, Effect, FiberHandle, Layer, Option, Ref } from 'effect';
import { resolveSharedConfigDir } from '../../accounts/paths.ts';
import { EngineConfig } from '../../config/service.ts';
import { type Env, USAGE_FILE, type UsageSource } from '../schema.ts';
import { ExtensionFiles } from '../store/service.ts';
import { normalizeServerName, resolveServerLabel } from '../usage/names.ts';
import { ExtensionUsage } from '../usage/service.ts';
import { UsageIndexLimits, type UsageRefresh, type UsageView } from './schema.ts';

export class UsageIndex extends Context.Service<
  UsageIndex,
  {
    readonly view: Effect.Effect<UsageView>;
    readonly isStale: (maxAgeMs: number) => Effect.Effect<boolean>;
    readonly refresh: Effect.Effect<void>;
    readonly stop: Effect.Effect<void>;
  }
>()('shinsa/engine/extensions/usage-index/UsageIndex') {
  static readonly layer = (env: Env) =>
    Layer.effect(
      UsageIndex,
      Effect.gen(function* () {
        const usage = yield* ExtensionUsage;
        const files = yield* ExtensionFiles;
        const config = yield* EngineConfig;
        const { horizonDays, chunkBytes } = yield* UsageIndexLimits;
        const sources: UsageSource[] = [
          { dir: join(resolveSharedConfigDir(env, config.userHome), 'projects'), kind: 'claude' },
          { dir: config.transcriptsDir, kind: 'shinsa' },
        ];
        const cachePath = join(config.dataDir, USAGE_FILE);
        const file = yield* Ref.make(yield* files.readUsage(cachePath));
        const running = yield* Ref.make(Option.none<UsageRefresh>());
        const stopped = yield* Ref.make(false);
        const scanning = yield* FiberHandle.make<void>();

        const scanOnce = Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          const previous = yield* Ref.get(file);
          yield* Ref.set(
            file,
            yield* usage.scan({ sources, cachePath, now, horizonDays, chunkBytes }, previous)
          );
        });

        const start = Effect.gen(function* () {
          const current = yield* Ref.get(running);
          if (Option.isSome(current)) return current.value;
          const done = yield* Deferred.make<void>();
          if (yield* Ref.get(stopped)) {
            yield* Deferred.succeed(done, undefined);
            return done;
          }
          yield* Ref.set(running, Option.some(done));
          yield* FiberHandle.run(
            scanning,
            scanOnce.pipe(
              Effect.onExit((exit) =>
                Effect.andThen(Ref.set(running, Option.none()), Deferred.done(done, exit))
              )
            ),
            { startImmediately: true }
          );
          return done;
        });

        const refresh = Effect.flatMap(start, (done) =>
          Deferred.await(done).pipe(
            Effect.catchCause((cause) =>
              Cause.hasInterruptsOnly(cause) ? Effect.void : Effect.failCause(cause)
            )
          )
        );

        const isStale = Effect.fn('UsageIndex.isStale')(function* (maxAgeMs: number) {
          const { readAt } = yield* Ref.get(file);
          return readAt === null || (yield* Clock.currentTimeMillis) - readAt > maxAgeMs;
        });

        const view = Effect.map(Ref.get(file), ({ readAt, since, servers, labels, skills }): UsageView => ({
          read: { readAt, since },
          selectServer: (runtimeName) => {
            const name = normalizeServerName(runtimeName);
            const exact = servers[name] ?? null;
            const labelled = labels[resolveServerLabel(name)] ?? null;
            if (exact === null) return labelled;
            return labelled === null ? exact : Math.max(exact, labelled);
          },
          selectSkill: (name) => skills[name] ?? null,
        }));

        return UsageIndex.of({
          view,
          isStale,
          refresh,
          stop: Effect.andThen(Ref.set(stopped, true), FiberHandle.clear(scanning)),
        });
      })
    );
}
