import { Effect } from 'effect';
import { Shell } from '../../../apps/engine/src/shell/service.ts';
import { CLEAN_GIT_CONFIG, GitCommandFailed, type GitOptions } from './schema.ts';

export const runGit = Effect.fn('Kit.runGit')(function* (
  args: readonly string[],
  cwd: string,
  options: GitOptions = {}
) {
  const shell = yield* Shell;
  const date = options.at === undefined ? null : `@${Math.floor(options.at / 1000)} +0000`;
  const command = `git ${args.join(' ')}`;
  const result = yield* shell
    .run({
      argv: ['git', ...args],
      cwd,
      input: options.input,
      env: {
        ...CLEAN_GIT_CONFIG,
        ...options.env,
        ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}),
        ...(options.index ? { GIT_INDEX_FILE: options.index } : {}),
      },
      timeout: null,
    })
    .pipe(
      Effect.catchTag('CommandNotFound', (error) =>
        Effect.fail(
          new GitCommandFailed({
            command,
            code: 127,
            stderr: error.message,
            message: `${command}: ${error.message}`,
          })
        )
      )
    );
  if (result.code !== 0)
    return yield* new GitCommandFailed({
      command,
      code: result.code,
      stderr: result.stderr,
      message: `${command}: ${result.stderr}`,
    });
  return result.stdout;
});
