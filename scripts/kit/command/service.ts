import { Context, Effect, Layer } from 'effect';
import { Shell } from '../../../apps/engine/src/shell/index.ts';
import { type CommandArgv, CommandFailed, type CommandOptions, type CommandOutput } from './schema.ts';

export class Command extends Context.Service<
  Command,
  {
    run(argv: CommandArgv, options?: CommandOptions): Effect.Effect<CommandOutput>;
    text(argv: CommandArgv, options?: CommandOptions): Effect.Effect<string, CommandFailed>;
    lines(argv: CommandArgv, options?: CommandOptions): Effect.Effect<ReadonlyArray<string>, CommandFailed>;
  }
>()('shinsa/scripts/kit/command/Command') {
  static readonly layer = Layer.effect(
    Command,
    Effect.gen(function* () {
      const shell = yield* Shell;

      const run = Effect.fn('Command.run')(function* (argv: CommandArgv, options: CommandOptions = {}) {
        const result = yield* shell
          .run({ argv, cwd: options.cwd ?? process.cwd(), env: options.env, timeout: null })
          .pipe(
            Effect.catchTag('CommandNotFound', (error) =>
              Effect.succeed({ code: 127, stdout: '', stderr: error.message })
            )
          );
        return { code: result.code, stdout: result.stdout, stderr: result.stderr };
      });

      const text = Effect.fn('Command.text')(function* (argv: CommandArgv, options?: CommandOptions) {
        const output = yield* run(argv, options);
        if (output.code === 0) return output.stdout;
        const command = argv.slice(0, 2).join(' ');
        return yield* new CommandFailed({
          command,
          code: output.code,
          stderr: output.stderr,
          message: `${command} failed (${output.code}): ${output.stderr}`,
        });
      });

      const lines = Effect.fn('Command.lines')(function* (argv: CommandArgv, options?: CommandOptions) {
        const output = yield* text(argv, options);
        return output
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean);
      });

      return Command.of({ run, text, lines });
    })
  );
}
