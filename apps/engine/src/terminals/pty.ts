import { userInfo } from 'node:os';
import { Option } from 'effect';
import { resolveDefaultShell } from '../shell/login.ts';
import { DROPPED_KEYS, LOCALE_KEYS } from './schema.ts';

type Env = Record<string, string | undefined>;

export function resolveLoginShell(env: Env, readUser: () => { shell: string | null } = userInfo) {
  if (env.SHELL) return env.SHELL;
  const shell = Option.liftThrowable(readUser)().pipe(
    Option.flatMap((user) => Option.fromNullishOr(user.shell))
  );
  return Option.getOrElse(Option.filter(shell, Boolean), resolveDefaultShell);
}

export function resolveShellCommand(shell: string) {
  return [shell, '-l'];
}

export function resolveServiceCommand(shell: string, command: string) {
  return [shell, '-l', '-c', command];
}

export const PORT_PROBE_SOCKET = {
  data: (socket: { end: () => void }) => socket.end(),
};

const bindOnce = Option.liftThrowable((port: number) => {
  const listener = Bun.listen({ hostname: '127.0.0.1', port, socket: PORT_PROBE_SOCKET });
  const bound = listener.port;
  listener.stop(true);
  return bound;
});

export function listenOnce(port: number) {
  return Option.getOrNull(bindOnce(port));
}

export function resolveTerminalEnv(env: Env, version: string): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && !DROPPED_KEYS.test(key)) next[key] = value;
  }
  next.TERM = 'xterm-256color';
  next.COLORTERM = 'truecolor';
  next.TERM_PROGRAM = 'Shinsa';
  next.TERM_PROGRAM_VERSION = version;
  if (!LOCALE_KEYS.some((key) => next[key])) next.LANG = 'en_US.UTF-8';
  return next;
}
