import { join } from 'node:path';
import { APP_IDENTITY } from '@shinsa/core';
import { Option, Schema } from 'effect';
import type { SourceSetting } from '../source/schema.ts';
import { resolveCloudOrigin, selectOrigin } from '../source/source.ts';
import { ConfigFile, DEV_PORT, PortSetting, SERVER_HOST, type ServerHealth } from './schema.ts';

type Env = Record<string, string | undefined>;

const decodePort = Schema.decodeUnknownOption(PortSetting);

const decodeConfigFile = Schema.decodeUnknownOption(ConfigFile);

export function resolveConfigHome(env: Env, home: string) {
  return join(env.XDG_CONFIG_HOME || join(env.HOME || home, '.config'), APP_IDENTITY.configDir);
}

export function resolveConfigPath(env: Env, home: string) {
  if (env.SHINSA_HOME) return join(env.SHINSA_HOME, 'config.json');
  if (env.SHINSA_DATA_DIR) return join(env.SHINSA_DATA_DIR, 'config.json');
  return join(resolveConfigHome(env, home), 'config.json');
}

export function parseConfigPort(text: string | null) {
  return decodeConfigFile(text).pipe(
    Option.map((config) => config.port),
    Option.getOrNull
  );
}

export function resolveServerUrl({
  env,
  packaged,
  configPort,
  source,
}: {
  env: Env;
  packaged: boolean;
  configPort: number | null;
  source: SourceSetting;
}) {
  if (source.kind === 'cloud') return resolveCloudOrigin(env);
  const configured = selectOrigin(env.SHINSA_URL);
  if (configured) return configured;
  if (!packaged) return `http://${SERVER_HOST}:${DEV_PORT}`;
  const port = Option.getOrNull(decodePort(env.SHINSA_PORT)) ?? configPort ?? APP_IDENTITY.port;
  return `http://${SERVER_HOST}:${port}`;
}

export function describeServer(url: string, health: ServerHealth | null) {
  const name = APP_IDENTITY.appName;
  return health?.version ? `${name} ${health.version} at ${url}` : `${name} at ${url}`;
}
