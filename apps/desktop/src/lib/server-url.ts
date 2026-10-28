import { join } from 'node:path';
import { APP_IDENTITY } from '@shinsa/core';

type Env = Record<string, string | undefined>;

const DEV_PORT = 5181;

const HOST = '127.0.0.1';

function parsePort(value: unknown) {
  const port = typeof value === 'string' && value.trim() ? Number(value) : value;
  return typeof port === 'number' && Number.isInteger(port) && port > 0 && port <= 65_535 ? port : null;
}

function parseOrigin(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

export function resolveConfigPath(env: Env, home: string) {
  if (env.SHINSA_HOME) return join(env.SHINSA_HOME, 'config.json');
  if (env.SHINSA_DATA_DIR) return join(env.SHINSA_DATA_DIR, 'config.json');
  return join(
    env.XDG_CONFIG_HOME || join(env.HOME || home, '.config'),
    APP_IDENTITY.configDir,
    'config.json'
  );
}

export function parseConfigPort(text: string | null) {
  if (!text) return null;
  try {
    const config: unknown = JSON.parse(text);
    return typeof config === 'object' && config !== null
      ? parsePort((config as { port?: unknown }).port)
      : null;
  } catch {
    return null;
  }
}

export function resolveServerUrl({
  env,
  packaged,
  configPort,
}: {
  env: Env;
  packaged: boolean;
  configPort: number | null;
}) {
  const configured = parseOrigin(env.SHINSA_URL);
  if (configured) return configured;
  if (!packaged) return `http://${HOST}:${DEV_PORT}`;
  return `http://${HOST}:${parsePort(env.SHINSA_PORT) ?? configPort ?? APP_IDENTITY.port}`;
}
