import { Effect } from 'effect';
import { NOT_STARTED_EXIT_CODE, type Argv } from '../schema.ts';
import { Shell } from '../service.ts';
import { mergeLoginEnvs, parseLoginEnv, resolveFishHandOff } from './env.ts';
import { LOGIN_MARKER, LOGIN_SHELL_ENV, type LoginEnvDefinition } from './schema.ts';

export const makeLoginEnvReader = Effect.fn('LoginEnv.make')(function* (definition: LoginEnvDefinition) {
  const shell = yield* Shell;
  const { home } = definition;

  const run =
    definition.run ??
    ((argv: Argv, cwd: string) =>
      shell.run({ argv, cwd, timeout: definition.timeout, env: LOGIN_SHELL_ENV }).pipe(
        Effect.catchTag('CommandNotFound', (missing) =>
          Effect.succeed({
            ok: false,
            code: NOT_STARTED_EXIT_CODE,
            stdout: '',
            stderr: missing.message,
            timedOut: false,
          })
        )
      ));

  const readShell = Effect.fn('LoginEnv.readShell')(function* (program: string, mode: string) {
    const result = yield* run([program, mode, `printf '%s' ${LOGIN_MARKER}; /usr/bin/env -0`], home);
    return {
      env: parseLoginEnv(result.stdout),
      attempt: { shell: program, mode, code: result.code, timedOut: result.timedOut },
    };
  });

  const readOnce = Effect.gen(function* () {
    const interactive = yield* readShell(definition.shell, '-lic');
    if (interactive.env) return interactive.env;
    const plain = yield* readShell(definition.shell, '-lc');
    const fish = resolveFishHandOff(
      definition.shell,
      plain.env?.PATH ?? definition.env.PATH ?? '',
      definition.env,
      home
    );
    const attempts = [interactive.attempt, plain.attempt];
    const handedOff = fish ? yield* readShell(fish, '-lc') : null;
    if (handedOff) attempts.push(handedOff.attempt);
    const merged = mergeLoginEnvs(plain.env, handedOff?.env ?? null);
    const fields = { shell: definition.shell, fish, attempts };
    if (merged) {
      yield* Effect.logInfo('[Serve] Read the login shell environment without -i').pipe(
        Effect.annotateLogs(fields)
      );
      return merged;
    }
    yield* Effect.logWarning('[Serve] Could not read the login shell environment').pipe(
      Effect.annotateLogs(fields)
    );
    return null;
  });

  return yield* Effect.cached(readOnce);
});
