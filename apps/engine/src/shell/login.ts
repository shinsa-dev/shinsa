import { accessSync, constants, existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, delimiter, join } from 'node:path';
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

interface TerminalStreams {
  stdin: { isTTY?: boolean };
  stdout: { isTTY?: boolean };
}

export interface LoginEnvReader {
  read: () => Promise<Record<string, string> | null>;
}

const MARKER = '__SHINSA_LOGIN_ENV__';

const LOGIN_TIMEOUT_MS = 5_000;

const SKIPPED_KEYS = new Set(['PWD', 'OLDPWD', 'SHLVL', '_', 'DISABLE_AUTO_UPDATE']);

export function isStartedFromTerminal(streams: TerminalStreams = process) {
  return Boolean(streams.stdin.isTTY || streams.stdout.isTTY);
}

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

function isExecutable(path: string) {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function readText(path: string) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

function resolveRcFile(shell: string, env: Env, home: string) {
  if (basename(shell).includes('bash')) return join(home, '.bashrc');
  return join(env.ZDOTDIR ?? home, '.zshrc');
}

function resolveFishHandOff(shell: string, path: string, env: Env, home: string) {
  const onPath = path
    .split(delimiter)
    .filter(Boolean)
    .map((dir) => join(dir, 'fish'))
    .find(isExecutable);
  if (onPath) return onPath;
  return readText(resolveRcFile(shell, env, home)).match(/\bexec\s+(\S*\bfish)\b/)?.[1] ?? null;
}

function mergeLoginEnvs(shell: Record<string, string> | null, fish: Record<string, string> | null) {
  if (!(shell && fish)) return shell ?? fish;
  return { ...fish, ...shell, PATH: mergePathLists(shell.PATH ?? '', fish.PATH ?? '') };
}

export function resolveDefaultShell(platform: string = process.platform) {
  return platform === 'darwin' ? '/bin/zsh' : '/bin/sh';
}

export function createLoginEnvReader(env: Env = process.env, options: LoginEnvOptions = {}): LoginEnvReader {
  const shell = options.shell ?? env.SHELL ?? resolveDefaultShell();
  const home = options.home ?? env.HOME ?? homedir();
  const timeoutMs = options.timeoutMs ?? LOGIN_TIMEOUT_MS;
  const run: ShellRunner =
    options.run ??
    ((command, cwd) => runCommand(command, cwd, { timeoutMs, env: { DISABLE_AUTO_UPDATE: 'true' } }));
  const readShell = async (program: string, mode: string) => {
    const result = await run([program, mode, `printf '%s' ${MARKER}; /usr/bin/env -0`], home);
    return {
      env: parseLoginEnv(result.stdout),
      attempt: { shell: program, mode, code: result.code, timedOut: result.timedOut },
    };
  };
  let cached: Promise<Record<string, string> | null> | null = null;
  const readOnce = async () => {
    const interactive = await readShell(shell, '-lic');
    if (interactive.env) return interactive.env;
    const plain = await readShell(shell, '-lc');
    const fish = resolveFishHandOff(shell, plain.env?.PATH ?? env.PATH ?? '', env, home);
    const attempts = [interactive.attempt, plain.attempt];
    let fishEnv: Record<string, string> | null = null;
    if (fish) {
      const handedOff = await readShell(fish, '-lc');
      attempts.push(handedOff.attempt);
      fishEnv = handedOff.env;
    }
    const merged = mergeLoginEnvs(plain.env, fishEnv);
    if (merged) {
      log.info('[Serve] Read the login shell environment without -i', { shell, fish, attempts });
      return merged;
    }
    log.warn('[Serve] Could not read the login shell environment', { shell, fish, attempts });
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
