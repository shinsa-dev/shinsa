import { homedir } from 'node:os';
import { join } from 'node:path';

export type Env = Record<string, string | undefined>;

export interface ShinsaPaths {
  home: string;
  configPath: string;
  dataDir: string;
  legacyDataDir: string | null;
}

const CONFIG_FILE = 'config.json';

export function resolveUserHome(env: Env) {
  return env.HOME || homedir();
}

export function resolveShinsaPaths(env: Env): ShinsaPaths {
  if (env.SHINSA_HOME) {
    return {
      home: env.SHINSA_HOME,
      configPath: join(env.SHINSA_HOME, CONFIG_FILE),
      dataDir: join(env.SHINSA_HOME, 'data'),
      legacyDataDir: null,
    };
  }
  if (env.SHINSA_DATA_DIR) {
    return {
      home: env.SHINSA_DATA_DIR,
      configPath: join(env.SHINSA_DATA_DIR, CONFIG_FILE),
      dataDir: env.SHINSA_DATA_DIR,
      legacyDataDir: null,
    };
  }
  const user = resolveUserHome(env);
  const home = join(env.XDG_CONFIG_HOME || join(user, '.config'), 'shinsa');
  return {
    home,
    configPath: join(home, CONFIG_FILE),
    dataDir: join(home, 'data'),
    legacyDataDir: join(user, '.shinsa'),
  };
}
