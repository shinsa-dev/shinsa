import { Context, Effect, Layer, Schema } from 'effect';
import { JsonText } from '../files/schema.ts';
import { describeFailure } from '../shell/failure.ts';
import type { CommandResult } from '../shell/schema.ts';
import { GitHubProcess } from './process/service.ts';
import { GitHubAnswerInvalid, GitHubFailed, type GitHubRun } from './schema.ts';

export class GitHubCli extends Context.Service<
  GitHubCli,
  {
    attempt(args: readonly string[], cwd: string, options?: GitHubRun): Effect.Effect<CommandResult>;
    run(args: readonly string[], cwd: string, options?: GitHubRun): Effect.Effect<string, GitHubFailed>;
    json<A>(
      schema: Schema.Decoder<A>,
      args: readonly string[],
      cwd: string,
      options?: GitHubRun
    ): Effect.Effect<A, GitHubFailed | GitHubAnswerInvalid>;
  }
>()('shinsa/engine/github/GitHubCli') {
  static readonly layer = Layer.effect(
    GitHubCli,
    Effect.gen(function* () {
      const { attempt } = yield* GitHubProcess;
      const decodeText = Schema.decodeUnknownEffect(JsonText);

      const run = Effect.fn('GitHubCli.run')(function* (
        args: readonly string[],
        cwd: string,
        options: GitHubRun = {}
      ) {
        const result = yield* attempt(args, cwd, options);
        if (!result.ok) return yield* new GitHubFailed({ message: describeFailure(['gh', ...args], result) });
        return result.stdout;
      });

      const json = Effect.fn('GitHubCli.json')(function* <A>(
        schema: Schema.Decoder<A>,
        args: readonly string[],
        cwd: string,
        options: GitHubRun = {}
      ) {
        const output = yield* run(args, cwd, options);
        const invalid = (reason: string) =>
          new GitHubAnswerInvalid({ message: `gh ${args.slice(0, 2).join(' ')} answered: ${reason}` });
        const value = yield* decodeText(output).pipe(Effect.mapError((error) => invalid(error.message)));
        return yield* Schema.decodeUnknownEffect(schema)(value).pipe(
          Effect.mapError((error) => invalid(error.message))
        );
      });

      return GitHubCli.of({ attempt, run, json });
    })
  );
}
