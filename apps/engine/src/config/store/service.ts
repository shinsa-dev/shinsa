import { Context, Effect, Layer, SynchronizedRef } from 'effect';
import type { JsonFileWriteFailed } from '../../files/schema.ts';
import { JsonFile } from '../../files/service.ts';
import type { MachineConfig } from '../machine/schema.ts';
import { EngineConfig } from '../service.ts';

export class ConfigStore extends Context.Service<
  ConfigStore,
  {
    readonly path: string;
    readonly config: Effect.Effect<MachineConfig>;
    update(patch: Partial<Omit<MachineConfig, 'version'>>): Effect.Effect<MachineConfig, JsonFileWriteFailed>;
  }
>()('shinsa/engine/config/store/ConfigStore') {
  static readonly layer = Layer.effect(
    ConfigStore,
    Effect.gen(function* () {
      const { configPath: path, machine: read } = yield* EngineConfig;
      const files = yield* JsonFile;
      const copy = read.unreadable ? yield* Effect.option(files.keepAside(path)) : null;
      for (const problem of read.problems) {
        yield* Effect.logWarning('[Config] Part of config.json was not used').pipe(
          Effect.annotateLogs({ path, problem, ...(copy?._tag === 'Some' ? { copy: copy.value } : {}) })
        );
      }
      const current = yield* SynchronizedRef.make(read.config);

      const update = Effect.fn('ConfigStore.update')(function* (
        patch: Partial<Omit<MachineConfig, 'version'>>
      ) {
        return yield* SynchronizedRef.modifyEffect(current, (before) => {
          const next = { ...before, ...patch };
          return Effect.as(files.write(path, next), [next, next] as const);
        });
      });

      return ConfigStore.of({ path, config: SynchronizedRef.get(current), update });
    })
  );
}
