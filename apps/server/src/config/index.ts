import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export interface ServerConfig {
  dataDir: string;
  databasePath: string;
  worktreesDir: string;
  evidenceDir: string;
  transcriptsDir: string;
  pluginDir: string;
  webDir: string;
  port: number;
  hostname: string;
  allowedHosts: string[];
  roots: string[];
  inspect: boolean;
  editor: string | null;
  terminal: string;
  settleDelayMs: number;
}

type Env = Record<string, string | undefined>;

export const DEFAULT_PORT = 5180;

const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

const WILDCARD_HOSTS = new Set(['0.0.0.0', '::', '[::]']);

const DEFAULT_ROOTS = ['Developer/Projects', 'Developer', 'Projects', 'code', 'src', 'repos'];

function readList(value: string | undefined, separator: string) {
  return (value ?? '')
    .split(separator)
    .map((item) => item.trim())
    .filter(Boolean);
}

function readNumber(env: Env, key: string, fallback: number) {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${key} must be a whole number, not "${raw}".`);
  return value;
}

export function resolvePort(env: Env) {
  const port = readNumber(env, 'SHINSA_PORT', DEFAULT_PORT);
  if (port > 65_535) throw new Error(`SHINSA_PORT must be a port number, not "${port}".`);
  return port;
}

export function resolveConfig(env: Env): ServerConfig {
  const home = env.HOME || homedir();
  const dataDir = env.SHINSA_DATA_DIR || join(home, '.shinsa');
  const hostname = env.SHINSA_HOST || '127.0.0.1';
  const configured = WILDCARD_HOSTS.has(hostname) ? [] : [hostname];
  const config: ServerConfig = {
    dataDir,
    databasePath: join(dataDir, 'shinsa.sqlite'),
    worktreesDir: env.SHINSA_WORKTREES_DIR || join(dataDir, 'worktrees'),
    evidenceDir: join(dataDir, 'evidence'),
    transcriptsDir: join(dataDir, 'transcripts'),
    pluginDir: resolve(import.meta.dirname, '../../plugin'),
    webDir: resolve(import.meta.dirname, '../../../web/dist'),
    port: resolvePort(env),
    hostname,
    allowedHosts: [
      ...new Set([...LOOPBACK_HOSTS, ...configured, ...readList(env.SHINSA_ALLOWED_HOSTS, ',')]),
    ],
    roots: [...readList(env.SHINSA_ROOTS, ':'), ...DEFAULT_ROOTS.map((path) => join(home, path))],
    inspect: env.SHINSA_INSPECT === '1',
    editor: env.SHINSA_EDITOR || null,
    terminal: env.SHINSA_TERMINAL || 'Terminal',
    settleDelayMs: readNumber(env, 'SHINSA_SETTLE_DELAY_MS', 15_000),
  };
  for (const dir of [config.dataDir, config.worktreesDir, config.evidenceDir, config.transcriptsDir]) {
    mkdirSync(dir, { recursive: true });
  }
  return config;
}
