import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { APP_IDENTITY, REMOTE_APP_ORIGIN } from '@shinsa/core';
import { BUNDLE, resolveBundlePath, type ShinsaBundle } from '../instance/bundle.ts';
import { log } from '../log/index.ts';
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
  checkBasesDir: string;
  scratchDir: string;
  cachesDir: string;
  evidenceDir: string;
  attachmentsDir: string;
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
  simulateMissing: string[];
  editor: string | null;
  terminal: string;
  settleDelayMs: number;
  pushRetryMs: number;
  overloadRetryMs: number;
  remoteOrigin: string;
}

const DATABASE_FILE = 'shinsa.sqlite';
const NEVER_INDEX_MARKER = '.metadata_never_index';
const BACKUP_EXCLUSION = {
  name: 'com.apple.metadata:com_apple_backup_excludeItem',
  value:
    '62706c69737430305f1011636f6d2e6170706c652e6261636b75706408000000000000010100000000000000010000000000000000000000000000001c',
};

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

function resolvePortFrom(env: Env, machine: MachineConfig) {
  const port = readNumber(env, 'SHINSA_PORT', machine.port ?? APP_IDENTITY.port);
  if (port > 65_535) throw new Error(`SHINSA_PORT must be a port number, not "${port}".`);
  return port;
}

function resolveHostname(env: Env, machine: MachineConfig) {
  return env.SHINSA_HOST || machine.hostname || '127.0.0.1';
}

export function resolveServerAddress(env: Env) {
  const machine = readMachineConfig(resolveShinsaPaths(env).configPath).config;
  const hostname = resolveHostname(env, machine);
  return {
    hostname: WILDCARD_HOSTS.has(hostname) ? '127.0.0.1' : hostname,
    port: resolvePortFrom(env, machine),
  };
}

function resolveDataPaths(dataDir: string, env: Env) {
  return {
    dataDir,
    databasePath: join(dataDir, DATABASE_FILE),
    worktreesDir: env.SHINSA_WORKTREES_DIR || join(dataDir, 'worktrees'),
    checkBasesDir: join(dataDir, 'check-bases'),
    scratchDir: join(dataDir, 'scratch'),
    cachesDir: join(dataDir, 'caches'),
    evidenceDir: join(dataDir, 'evidence'),
    attachmentsDir: join(dataDir, 'attachments'),
    transcriptsDir: join(dataDir, 'transcripts'),
  };
}

export function resolveConfig(env: Env, bundle: ShinsaBundle | null = BUNDLE): ServerConfig {
  const paths = resolveShinsaPaths(env);
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
    port: resolvePortFrom(env, machine),
    hostname,
    allowedHosts: [
      ...new Set([...LOOPBACK_HOSTS, ...configured, ...readList(env.SHINSA_ALLOWED_HOSTS, ',')]),
    ],
    userHome: resolveUserHome(env),
    machine: read,
    roots: readList(env.SHINSA_ROOTS, ':'),
    inspect: env.SHINSA_INSPECT === '1',
    simulateMissing: readList(env.SHINSA_SIMULATE_MISSING, ','),
    editor: env.SHINSA_EDITOR || machine.editor,
    terminal: env.SHINSA_TERMINAL || machine.terminal || 'Terminal',
    settleDelayMs: readNumber(env, 'SHINSA_SETTLE_DELAY_MS', 15_000),
    pushRetryMs: readNumber(env, 'SHINSA_PUSH_RETRY_MS', 30_000),
    overloadRetryMs: readNumber(env, 'SHINSA_OVERLOAD_RETRY_MS', 15_000),
    remoteOrigin: env.SHINSA_REMOTE_ORIGIN || REMOTE_APP_ORIGIN,
  };
}

function excludeFromBackups(dir: string) {
  const marker = join(dir, NEVER_INDEX_MARKER);
  if (existsSync(marker)) return;
  writeFileSync(marker, '');
  const xattr = process.platform === 'darwin' ? Bun.which('xattr', { PATH: process.env.PATH ?? '' }) : null;
  if (!xattr) return;
  const result = Bun.spawnSync([xattr, '-wx', BACKUP_EXCLUSION.name, BACKUP_EXCLUSION.value, dir], {
    stdout: 'ignore',
    stderr: 'pipe',
  });
  if (!result.success) {
    log.warn('[Config] Could not exclude a folder from Time Machine', {
      dir,
      error: result.stderr.toString().trim(),
    });
  }
}

export function prepareDataDir(config: ServerConfig) {
  for (const dir of [config.dataDir, config.evidenceDir, config.transcriptsDir]) {
    mkdirSync(dir, { recursive: true });
  }
  for (const dir of [config.worktreesDir, config.checkBasesDir, config.scratchDir, config.cachesDir]) {
    mkdirSync(dir, { recursive: true });
    excludeFromBackups(dir);
  }
}
