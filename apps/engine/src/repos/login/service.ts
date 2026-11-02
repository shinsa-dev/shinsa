import { Context, Duration, Effect, Exit, Layer } from 'effect';
import { GitHubFailed } from '../../github/schema.ts';
import { GitHubCli } from '../../github/service.ts';

export class GitHubLogins extends Context.Service<
  GitHubLogins,
  { make(cwd: string): Effect.Effect<Effect.Effect<string | null>> }
>()('shinsa/engine/repos/login/GitHubLogins') {
  static readonly layer = Layer.effect(
    GitHubLogins,
    Effect.gen(function* () {
      const gh = yield* GitHubCli;

      const make = Effect.fn('GitHubLogins.make')(function* (cwd: string) {
        const lookup = Effect.flatMap(gh.attempt(['api', 'user', '--jq', '.login'], cwd), (result) =>
          result.ok
            ? Effect.succeed(result.stdout.toLowerCase())
            : Effect.fail(new GitHubFailed({ message: result.stderr }))
        );
        const cached = yield* Effect.cachedWithTTL(lookup, (exit) =>
          Exit.isSuccess(exit) ? Duration.infinity : Duration.zero
        );
        return cached.pipe(Effect.orElseSucceed(() => null));
      });

      return GitHubLogins.of({ make });
    })
  );
}
