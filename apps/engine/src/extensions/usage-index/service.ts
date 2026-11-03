import { Cause, Deferred, Effect, FiberHandle, Option, Ref } from 'effect';
import { ExtensionFiles } from '../store/service.ts';
import { normalizeServerName, resolveServerLabel } from '../usage/names.ts';
import { ExtensionUsage } from '../usage/service.ts';
import type { UsageIndexDefinition, UsageIndexHandle, UsageRefresh } from './schema.ts';

export const makeUsageIndex = Effect.fn('UsageIndex.make')(function* (definition: UsageIndexDefinition) {
  const usage = yield* ExtensionUsage;
  const files = yield* ExtensionFiles;
  const { sources, cachePath, horizonDays, chunkBytes } = definition;
  const file = yield* Ref.make(yield* files.readUsage(cachePath));
  const running = yield* Ref.make(Option.none<UsageRefresh>());
  const stopped = yield* Ref.make(false);
  const scanning = yield* FiberHandle.make<void>();

  const scanOnce = Effect.gen(function* () {
    const now = yield* definition.now;
    const previous = yield* Ref.get(file);
    yield* Ref.set(file, yield* usage.scan({ sources, cachePath, now, horizonDays, chunkBytes }, previous));
  });

  const refresh = Effect.gen(function* () {
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
        Effect.onExit((exit) => Effect.andThen(Ref.set(running, Option.none()), Deferred.done(done, exit)))
      ),
      { startImmediately: true }
    );
    return done;
  });

  const join = (done: UsageRefresh) =>
    Deferred.await(done).pipe(
      Effect.catchCause((cause) => (Cause.hasInterruptsOnly(cause) ? Effect.void : Effect.failCause(cause)))
    );

  const isStale = Effect.fn('UsageIndex.isStale')(function* (maxAgeMs: number) {
    const { readAt } = yield* Ref.get(file);
    return readAt === null || (yield* definition.now) - readAt > maxAgeMs;
  });

  const selectServer = Effect.fn('UsageIndex.selectServer')(function* (runtimeName: string) {
    const { servers, labels } = yield* Ref.get(file);
    const name = normalizeServerName(runtimeName);
    const exact = servers[name] ?? null;
    const labelled = labels[resolveServerLabel(name)] ?? null;
    if (exact === null) return labelled;
    return labelled === null ? exact : Math.max(exact, labelled);
  });

  const handle: UsageIndexHandle = {
    read: Effect.map(Ref.get(file), ({ readAt, since }) => ({ readAt, since })),
    selectServer,
    selectSkill: (name) => Effect.map(Ref.get(file), ({ skills }) => skills[name] ?? null),
    isStale,
    refresh,
    join,
    stop: Effect.andThen(Ref.set(stopped, true), FiberHandle.clear(scanning)),
  };
  return handle;
});
