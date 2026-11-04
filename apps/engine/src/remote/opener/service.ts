import { Context, Effect, Layer } from 'effect';
import { EngineConfig } from '../../config/service.ts';
import { describeError } from '../../log/redact.ts';
import { runCommandOrThrow } from '../../shell/command.ts';
import { Shell } from '../../shell/service.ts';
import { RemoteUrlUnopened } from '../machine/schema.ts';
import { BrowserCommand } from './schema.ts';

export class RemoteUrlOpener extends Context.Service<
  RemoteUrlOpener,
  {
    open(url: string): Effect.Effect<void, RemoteUrlUnopened>;
  }
>()('shinsa/engine/remote/opener/RemoteUrlOpener') {
  static readonly layer = Layer.effect(
    RemoteUrlOpener,
    Effect.gen(function* () {
      const shell = yield* Shell;
      const config = yield* EngineConfig;
      const resolveCommand = yield* BrowserCommand;

      const open = Effect.fn('RemoteUrlOpener.open')(function* (url: string) {
        const command = resolveCommand(url);
        if (!command) return;
        yield* runCommandOrThrow(command, config.userHome).pipe(
          Effect.provideService(Shell, shell),
          Effect.mapError((error) => new RemoteUrlUnopened({ message: describeError(error) }))
        );
      });

      return RemoteUrlOpener.of({ open });
    })
  );
}
