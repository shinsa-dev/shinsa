import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { log } from '../log/index.ts';
import { type CommandResult, runCommand } from './index.ts';

type Env = Record<string, string | undefined>;

type ShellRunner = (command: string[], cwd: string) => Promise<CommandResult>;

export interface LoginEnvOptions {
  shell?: string;
  home?: string;
  timeoutMs?: number;
  run?: ShellRunner;
}

export interface LoginEnvReader {
  read: () => Promise<Record<string, string> | null>;
}

const MARKER = '__SHINSA_LOGIN_ENV__';

const LOGIN_TIMEOUT_MS = 5_000;

const SKIPPED_KEYS = new Set(['PWD', 'OLDPWD', 'SHLVL', '_', 'DISABLE_AUTO_UPDATE']);

export function parseLoginEnv(output: string) {
  const start = output.indexOf(MARKER);
  if (start < 0) return null;
  const env: Record<string, string> = {};
  for (const entry of output.slice(start + MARKER.length).split('\0')) {
    const equals = entry.indexOf('=');
    if (equals <= 0) continue;
    const key = entry.slice(0, equals);
    if (!SKIPPED_KEYS.has(key)) env[key] = entry.slice(equals + 1);
  }
  return env;
}

export function mergePathLists(current: string, extra: string) {
  const entries = [...current.split(delimiter), ...extra.split(delimiter)].filter(Boolean);
  return [...new Set(entries)].join(delimiter);
}

export function createLoginEnvReader(env: Env = process.env, options: LoginEnvOptions = {}): LoginEnvReader {
  const shell = options.shell ?? env.SHELL ?? '/bin/zsh';
  const timeoutMs = options.timeoutMs ?? LOGIN_TIMEOUT_MS;
  const run: ShellRunner =
    options.run ??
    ((command, cwd) => runCommand(command, cwd, { timeoutMs, env: { DISABLE_AUTO_UPDATE: 'true' } }));
  let cached: Promise<Record<string, string> | null> | null = null;
  const readOnce = async () => {
    const command = [shell, '-lic', `printf '%s' ${MARKER}; /usr/bin/env -0`];
    const result = await run(command, options.home ?? env.HOME ?? homedir());
    const parsed = parseLoginEnv(result.stdout);
    if (parsed) return parsed;
    log.warn('[Serve] Could not read the login shell environment', {
      shell,
      code: result.code,
      timedOut: result.timedOut,
    });
    return null;
  };
  return {
    read: () => {
      cached ??= readOnce();
      return cached;
    },
  };
}

function listInstallFolders(home: string) {
  return [join(home, '.bun/bin'), join(home, '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin'].filter(
    (dir) => existsSync(dir)
  );
}

export async function applyLoginEnv(env: Env, reader: LoginEnvReader, home = env.HOME ?? homedir()) {
  const login = await reader.read();
  const current = env.PATH ?? '';
  if (!login) {
    env.PATH = mergePathLists(current, listInstallFolders(home).join(delimiter));
    return [];
  }
  const added = Object.keys(login).filter((key) => key !== 'PATH' && env[key] === undefined);
  for (const key of added) env[key] = login[key];
  env.PATH = mergePathLists(current, login.PATH ?? '');
  return added;
}
