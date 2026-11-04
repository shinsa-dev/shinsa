import { homedir } from 'node:os';
import { Effect } from 'effect';
import { mergePathLists, refreshInstallFolders, resolveDefaultShell } from './login/env.ts';
import { type Env, LOGIN_TIMEOUT, type LoginEnvOptions } from './login/schema.ts';
import { makeLoginEnvReader } from './login/service.ts';

export {
  isStartedFromTerminal,
  mergePathLists,
  parseLoginEnv,
  refreshInstallFolders,
  resolveDefaultShell,
} from './login/env.ts';
export type { LoginEnvOptions } from './login/schema.ts';

export function createLoginEnvReader(env: Env = process.env, options: LoginEnvOptions = {}) {
  return makeLoginEnvReader({
    shell: options.shell ?? env.SHELL ?? resolveDefaultShell(),
    home: options.home ?? env.HOME ?? homedir(),
    env,
    timeout: options.timeout ?? LOGIN_TIMEOUT,
    run: options.run ?? null,
  });
}

export const applyLoginEnv = Effect.fn('applyLoginEnv')(function* (
  env: Env,
  read: Effect.Effect<Record<string, string> | null>,
  home = env.HOME ?? homedir()
) {
  const login = yield* read;
  const current = env.PATH ?? '';
  if (!login) {
    refreshInstallFolders(env, home);
    return [];
  }
  const added = Object.keys(login).filter((key) => key !== 'PATH' && env[key] === undefined);
  for (const key of added) env[key] = login[key];
  env.PATH = mergePathLists(current, login.PATH ?? '');
  return added;
});
