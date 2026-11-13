import { Context, Effect, Layer } from 'effect';
import { Shell } from '../../shell/service.ts';
import { parseHidIdleMs } from './parse.ts';
import { IDLE_COMMAND, IDLE_COMMAND_TIMEOUT } from './schema.ts';

export class MacIdle extends Context.Service<MacIdle, { readonly idleMs: Effect.Effect<number | null> }>()(
  'shinsa/engine/presence/mac-idle/MacIdle'
) {
  static readonly layer = Layer.effect(
    MacIdle,
    Effect.gen(function* () {
      const shell = yield* Shell;
      const idleMs = shell.run({ argv: [...IDLE_COMMAND], cwd: '/', timeout: IDLE_COMMAND_TIMEOUT }).pipe(
        Effect.map((result) => (result.ok ? parseHidIdleMs(result.stdout) : null)),
        Effect.orElseSucceed(() => null)
      );
      return MacIdle.of({ idleMs });
    })
  );
}
