import { execFile } from 'node:child_process';
import { Duration, Effect, Layer, Option } from 'effect';
import { LOGIN_SHELL_TIMEOUT } from '../command-line/schema.ts';
import { LoginShell } from '../login-shell/service.ts';

export const LoginShellLive = Layer.succeed(
  LoginShell,
  LoginShell.of({
    run: (program, args) =>
      Effect.callback<Option.Option<string>>((resume) => {
        const child = execFile(
          program,
          [...args],
          { timeout: Duration.toMillis(LOGIN_SHELL_TIMEOUT), env: { ...process.env, TERM: 'dumb' } },
          (error, stdout) => resume(Effect.succeed(error ? Option.none() : Option.some(stdout)))
        );
        return Effect.sync(() => child.kill());
      }),
  })
);
