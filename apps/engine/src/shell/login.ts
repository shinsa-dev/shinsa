import { homedir } from 'node:os';
import { Duration, Effect } from 'effect';
import { edgeRuntime } from '../runtime/edge.ts';
import { mergePathLists, refreshInstallFolders, resolveDefaultShell } from './login/env.ts';
import { type Env, LOGIN_TIMEOUT, type LoginEnvOptions, type LoginEnvReader } from './login/schema.ts';
import { makeLoginEnvReader } from './login/service.ts';

export {
  isStartedFromTerminal,
  mergePathLists,
  parseLoginEnv,
  refreshInstallFolders,
  resolveDefaultShell,
} from './login/env.ts';
export type { LoginEnvOptions, LoginEnvReader } from './login/schema.ts';

export function createLoginEnvReader(env: Env = process.env, options: LoginEnvOptions = {}): LoginEnvReader {
  const { run } = options;
  const read = edgeRuntime.runSync(
    makeLoginEnvReader({
      shell: options.shell ?? env.SHELL ?? resolveDefaultShell(),
      home: options.home ?? env.HOME ?? homedir(),
      env,
      timeout: options.timeoutMs === undefined ? LOGIN_TIMEOUT : Duration.millis(options.timeoutMs),
      run: run ? (argv, cwd) => Effect.promise(() => run([...argv], cwd)) : null,
    })
  );
  return { read: () => edgeRuntime.runPromise(read) };
}

export function applyLoginEnv(env: Env, reader: LoginEnvReader, home = env.HOME ?? homedir()) {
  return edgeRuntime.runPromise(
    Effect.map(
      Effect.promise(() => reader.read()),
      (login) => {
        const current = env.PATH ?? '';
        if (!login) {
          refreshInstallFolders(env, home);
          return [];
        }
        const added = Object.keys(login).filter((key) => key !== 'PATH' && env[key] === undefined);
        for (const key of added) env[key] = login[key];
        env.PATH = mergePathLists(current, login.PATH ?? '');
        return added;
      }
    )
  );
}
