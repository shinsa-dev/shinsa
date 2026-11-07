import { dirname } from 'node:path';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { TestClock } from 'effect/testing';
import { EngineConfig } from '../../src/config/service.ts';
import { JsonLogger } from '../../src/log/service.ts';
import { SecretFiles } from '../../src/secrets/files/service.ts';
import { SecretStore } from '../../src/secrets/index.ts';
import { createConfigAt } from './config.ts';
import { JsonFileLayer } from './files.ts';
import { createTempDir } from './temp.ts';

export async function openTestSecrets(path: string) {
  const config = createConfigAt(createTempDir(), { dataDir: dirname(path) });
  const runtime = ManagedRuntime.make(
    SecretStore.layer.pipe(
      Layer.provide(SecretFiles.layer),
      Layer.provide(JsonFileLayer),
      Layer.provide(Layer.succeed(EngineConfig, config)),
      Layer.provideMerge(Layer.merge(TestClock.layer(), JsonLogger))
    )
  );
  const store = await runtime.runPromise(SecretStore.use(Effect.succeed));
  const run = <A, E>(effect: Effect.Effect<A, E>) => runtime.runPromise(effect);
  return {
    store,
    setTime: (time: number) => runtime.runPromise(TestClock.setTime(time)),
    resolveRef: (gateId: string) => run(store.resolveRef(gateId)),
    writeRef: (gateId: string, taskId: string, value: string) => run(store.writeRef(gateId, taskId, value)),
    hasRef: (ref: string) => run(store.hasRef(ref)),
    removeRef: (ref: string, taskId: string) => run(store.removeRef(ref, taskId)),
    removeExpiredRefs: () => run(store.removeExpiredRefs),
    selectHook: (scheduleId: string) => run(store.selectHook(scheduleId)),
    upsertHook: (scheduleId: string) => run(store.upsertHook(scheduleId)),
    writeHookSecret: (scheduleId: string, secret: string | null) =>
      run(store.writeHookSecret(scheduleId, secret)),
    pruneHooks: (live: ReadonlySet<string>) => run(store.pruneHooks(live)),
    selectMcpCredentials: (serverId: string) => run(store.selectMcpCredentials(serverId)),
    updateMcpCredentials: (serverId: string, patch: Record<string, unknown>) =>
      run(store.updateMcpCredentials(serverId, patch)),
    removeMcpCredentials: (serverId: string) => run(store.removeMcpCredentials(serverId)),
  };
}
