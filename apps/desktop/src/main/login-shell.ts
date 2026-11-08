import { Effect, Layer, Option } from 'effect';
import { ChildProcessSpawner } from 'effect/process';
import { LOGIN_SHELL_ENV, LOGIN_SHELL_TIMEOUT } from '../command-line/schema.ts';
import { LoginShell } from '../login-shell/service.ts';
import { runProcess } from '../processes/run.ts';

export const LoginShellLive = Layer.effect(
  LoginShell,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    return LoginShell.of({
      run: (program, args) =>
        runProcess(program, args, { timeout: LOGIN_SHELL_TIMEOUT, env: LOGIN_SHELL_ENV }).pipe(
          Effect.map(Option.flatMap((result) => (result.ok ? Option.some(result.stdout) : Option.none()))),
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner)
        ),
    });
  })
);
