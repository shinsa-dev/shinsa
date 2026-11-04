import { Context, type Duration, Effect, Layer } from 'effect';
import { type Argv, type CommandEnv, type CommandResult, NOT_STARTED_EXIT_CODE } from '../../shell/schema.ts';
import { Shell } from '../../shell/service.ts';

export class AccountCommands extends Context.Service<
  AccountCommands,
  {
    run(
      argv: Argv,
      cwd: string,
      options: { readonly env?: CommandEnv; readonly timeout: Duration.Duration }
    ): Effect.Effect<CommandResult>;
  }
>()('shinsa/engine/accounts/command/AccountCommands') {
  static readonly layer = Layer.effect(
    AccountCommands,
    Effect.gen(function* () {
      const shell = yield* Shell;

      const run = Effect.fn('AccountCommands.run')(function* (
        argv: Argv,
        cwd: string,
        options: { readonly env?: CommandEnv; readonly timeout: Duration.Duration }
      ) {
        return yield* shell.run({ argv, cwd, env: options.env, timeout: options.timeout }).pipe(
          Effect.catchTag('CommandNotFound', (missing) =>
            Effect.succeed<CommandResult>({
              ok: false,
              code: NOT_STARTED_EXIT_CODE,
              stdout: '',
              stderr: missing.message,
              timedOut: false,
            })
          )
        );
      });

      return AccountCommands.of({ run });
    })
  );
}
