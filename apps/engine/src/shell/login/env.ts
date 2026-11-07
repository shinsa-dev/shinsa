import { homedir } from 'node:os';
import { basename, delimiter, join } from 'node:path';
import { Effect, Option } from 'effect';
import { isExecutable, isPresent, selectText } from '../../files/probe.ts';
import { type Env, LOGIN_MARKER, SKIPPED_KEYS, type TerminalStreams } from './schema.ts';

export function isStartedFromTerminal(streams: TerminalStreams = process) {
  return Boolean(streams.stdin.isTTY || streams.stdout.isTTY);
}

export function parseLoginEnv(output: string) {
  const start = output.indexOf(LOGIN_MARKER);
  if (start < 0) return null;
  const env: Record<string, string> = {};
  for (const entry of output.slice(start + LOGIN_MARKER.length).split('\0')) {
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

export function mergeLoginEnvs(shell: Record<string, string> | null, fish: Record<string, string> | null) {
  if (!(shell && fish)) return shell ?? fish;
  return { ...fish, ...shell, PATH: mergePathLists(shell.PATH ?? '', fish.PATH ?? '') };
}

export function resolveDefaultShell(platform: string = process.platform) {
  return platform === 'darwin' ? '/bin/zsh' : '/bin/sh';
}

export const resolveFishHandOff = Effect.fn('LoginEnv.resolveFishHandOff')(function* (
  shell: string,
  path: string,
  env: Env,
  home: string
) {
  for (const dir of path.split(delimiter).filter(Boolean)) {
    const candidate = join(dir, 'fish');
    if (yield* isExecutable(candidate)) return candidate;
  }
  const isBash = basename(shell).includes('bash');
  const rcFile = isBash ? join(home, '.bashrc') : join(env.ZDOTDIR ?? home, '.zshrc');
  const rc = Option.getOrElse(yield* selectText(rcFile), () => '');
  return rc.match(/\bexec\s+(\S*\bfish)\b/)?.[1] ?? null;
});

export const refreshInstallFolders = Effect.fn('LoginEnv.refreshInstallFolders')(function* (
  env: Env = process.env,
  home = env.HOME ?? homedir()
) {
  const folders = [join(home, '.bun/bin'), join(home, '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin'];
  const present: string[] = [];
  for (const dir of folders) if (yield* isPresent(dir)) present.push(dir);
  env.PATH = mergePathLists(env.PATH ?? '', present.join(delimiter));
});
