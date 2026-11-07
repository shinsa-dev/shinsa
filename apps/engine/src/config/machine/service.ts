import { Context, Effect, FileSystem, Layer } from 'effect';
import { constFalse } from 'effect/Function';
import { describeError } from '../../log/redact.ts';
import { resolveMachineConfigText, resolveUnreadableMachineConfig } from './decode.ts';
import type { MachineConfigRead } from './schema.ts';

export class MachineConfigFile extends Context.Service<
  MachineConfigFile,
  { read(path: string): Effect.Effect<MachineConfigRead> }
>()('shinsa/engine/config/machine/MachineConfigFile') {
  static readonly layer = Layer.effect(
    MachineConfigFile,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const read = Effect.fn('MachineConfigFile.read')(function* (path: string) {
        const present = yield* fs.exists(path).pipe(Effect.orElseSucceed(constFalse));
        if (!present) return resolveMachineConfigText(null);
        return yield* fs.readFileString(path).pipe(
          Effect.map(resolveMachineConfigText),
          Effect.catch((error) => Effect.succeed(resolveUnreadableMachineConfig(describeError(error))))
        );
      });
      return MachineConfigFile.of({ read });
    })
  );
}
