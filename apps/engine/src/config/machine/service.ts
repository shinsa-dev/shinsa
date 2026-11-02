import { existsSync, readFileSync } from 'node:fs';
import { Context, Effect, Layer, Schema } from 'effect';
import { describeError } from '../../log/redact.ts';
import { createMachineConfig, parseMachineConfig } from './decode.ts';
import { MachineConfigJson, type MachineConfigRead, MachineConfigUnreadable } from './schema.ts';

export class MachineConfigFile extends Context.Service<
  MachineConfigFile,
  { read(path: string): Effect.Effect<MachineConfigRead> }
>()('shinsa/engine/config/machine/MachineConfigFile') {
  static readonly layer = Layer.sync(MachineConfigFile, () => {
    const decodeJson = Schema.decodeUnknownEffect(MachineConfigJson);
    const readText = (path: string) =>
      Effect.try({
        try: () => readFileSync(path, 'utf8'),
        catch: (error) => new MachineConfigUnreadable({ path, reason: describeError(error) }),
      });
    const read = Effect.fn('MachineConfigFile.read')(
      function* (path: string) {
        const present = yield* Effect.sync(() => existsSync(path));
        if (!present) return { config: createMachineConfig(), problems: [], unreadable: false };
        const text = yield* readText(path);
        const value = yield* decodeJson(text).pipe(
          Effect.mapError((error) => new MachineConfigUnreadable({ path, reason: error.message }))
        );
        return parseMachineConfig(value);
      },
      Effect.catchTag('MachineConfigUnreadable', (unreadable) =>
        Effect.succeed<MachineConfigRead>({
          config: createMachineConfig(),
          problems: [`The file is not valid JSON (${unreadable.reason}).`],
          unreadable: true,
        })
      )
    );
    return MachineConfigFile.of({ read });
  });
}
