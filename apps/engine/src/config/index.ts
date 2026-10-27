import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { FlavorIdentity } from '@shinsa/core';
import { BUNDLE, resolveBundlePath, type ShinsaBundle } from '../instance/bundle.ts';
import { FLAVOR } from '../instance/flavor.ts';
import { type MachineConfig, type MachineConfigRead, readMachineConfig } from './file.ts';
import { type Env, resolveShinsaPaths, resolveUserHome } from './paths.ts';

export { ConfigStore, writeJsonFile } from './file.ts';
export { type Env, resolveScratchPath, resolveShinsaPaths } from './paths.ts';

export interface ServerConfig {
  home: string;
  configPath: string;
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
  userHome: string;
  machine: MachineConfigRead;
  roots: string[];
  inspect: boolean;
  editor: string | null;
  terminal: string;
  settleDelayMs: number;
  eunoe: EunoeConfig;
}

interface EunoeConfig {
  command: string | null;
  port: number | null;
}

const DATABASE_FILE = 'shinsa.sqlite';

const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

const WILDCARD_HOSTS = new Set(['0.0.0.0', '::', '[::]']);

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

function resolveEunoe(env: Env): EunoeConfig {
  const port = env.SHINSA_EUNOE_PORT ? readNumber(env, 'SHINSA_EUNOE_PORT', 0) : null;
  if (port !== null && (port === 0 || port > 65_535)) {
    throw new Error(`SHINSA_EUNOE_PORT must be a port number, not "${port}".`);
  }
  return { command: env.SHINSA_EUNOE || null, port };
}

function resolvePortFrom(env: Env, machine: MachineConfig, flavor: FlavorIdentity) {
  const port = readNumber(env, 'SHINSA_PORT', machine.port ?? flavor.port);
  if (port > 65_535) throw new Error(`SHINSA_PORT must be a port number, not "${port}".`);
  return port;
}

function resolveHostname(env: Env, machine: MachineConfig) {
  return env.SHINSA_HOST || machine.hostname || '127.0.0.1';
}

export function resolveServerAddress(env: Env, flavor: FlavorIdentity = FLAVOR) {
  const machine = readMachineConfig(resolveShinsaPaths(env, flavor).configPath).config;
  const hostname = resolveHostname(env, machine);
  return {
    hostname: WILDCARD_HOSTS.has(hostname) ? '127.0.0.1' : hostname,
    port: resolvePortFrom(env, machine, flavor),
  };
}

function resolveDataPaths(dataDir: string, env: Env) {
  return {
    dataDir,
    databasePath: join(dataDir, DATABASE_FILE),
    worktreesDir: env.SHINSA_WORKTREES_DIR || join(dataDir, 'worktrees'),
    evidenceDir: join(dataDir, 'evidence'),
    transcriptsDir: join(dataDir, 'transcripts'),
  };
}

export function resolveConfig(
  env: Env,
  bundle: ShinsaBundle | null = BUNDLE,
  flavor: FlavorIdentity = FLAVOR
): ServerConfig {
  const paths = resolveShinsaPaths(env, flavor);
  const read = readMachineConfig(paths.configPath);
  const machine = read.config;
  const hostname = resolveHostname(env, machine);
  const configured = WILDCARD_HOSTS.has(hostname) ? [] : [hostname];
  return {
    home: paths.home,
    configPath: paths.configPath,
    ...resolveDataPaths(paths.dataDir, env),
    pluginDir:
      env.SHINSA_PLUGIN_DIR ||
      (bundle ? resolveBundlePath(bundle, 'plugin') : resolve(import.meta.dirname, '../../plugin')),
    webDir:
      env.SHINSA_WEB_DIR ||
      (bundle ? resolveBundlePath(bundle, 'web') : resolve(import.meta.dirname, '../../../web/dist')),
    port: resolvePortFrom(env, machine, flavor),
    hostname,
    allowedHosts: [
      ...new Set([...LOOPBACK_HOSTS, ...configured, ...readList(env.SHINSA_ALLOWED_HOSTS, ',')]),
    ],
    userHome: resolveUserHome(env),
    machine: read,
    roots: readList(env.SHINSA_ROOTS, ':'),
    inspect: env.SHINSA_INSPECT === '1',
    editor: env.SHINSA_EDITOR || machine.editor,
    terminal: env.SHINSA_TERMINAL || machine.terminal || 'Terminal',
    settleDelayMs: readNumber(env, 'SHINSA_SETTLE_DELAY_MS', 15_000),
    eunoe: resolveEunoe(env),
  };
}

export function prepareDataDir(config: ServerConfig) {
  for (const dir of [config.dataDir, config.worktreesDir, config.evidenceDir, config.transcriptsDir]) {
    mkdirSync(dir, { recursive: true });
  }
}
