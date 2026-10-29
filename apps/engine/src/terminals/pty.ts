import { userInfo } from 'node:os';
import { DomainError } from '@shinsa/core';

type Env = Record<string, string | undefined>;

export interface TerminalProcess {
  pid: number;
  write: (data: string | Uint8Array) => void;
  resize: (cols: number, rows: number) => void;
  hangUp: () => void;
  exited: Promise<number>;
}

export interface TerminalSpawnOptions {
  cwd: string;
  cols: number;
  rows: number;
  env: Env;
  onData: (data: Uint8Array) => void;
}

export type TerminalSpawner = (command: string[], options: TerminalSpawnOptions) => TerminalProcess;

const DROPPED_KEYS =
  /^(?:TERM_PROGRAM|TERM_PROGRAM_VERSION|TERM_SESSION_ID|GHOSTTY_.*|ITERM_.*|SHINSA_SERVICE|COLUMNS|LINES)$/;

const LOCALE_KEYS = ['LC_ALL', 'LC_CTYPE', 'LANG'];

export function resolveLoginShell(env: Env, readUser: () => { shell: string | null } = userInfo) {
  if (env.SHELL) return env.SHELL;
  try {
    return readUser().shell || '/bin/zsh';
  } catch {
    return '/bin/zsh';
  }
}

export function resolveShellCommand(shell: string) {
  return [shell, '-l'];
}

export function resolveServiceCommand(shell: string, command: string) {
  return [shell, '-l', '-c', command];
}

export type PortListener = (port: number) => number | null;

export type PortPicker = (preferred: number | null, taken: ReadonlySet<number>) => number;

const PORT_ATTEMPTS = 20;

export const PORT_PROBE_SOCKET = {
  data: (socket: { end: () => void }) => socket.end(),
};

export function listenOnce(port: number) {
  try {
    const listener = Bun.listen({ hostname: '127.0.0.1', port, socket: PORT_PROBE_SOCKET });
    const bound = listener.port;
    listener.stop(true);
    return bound;
  } catch {
    return null;
  }
}

export function pickFreePort(
  preferred: number | null,
  taken: ReadonlySet<number>,
  listen: PortListener = listenOnce
) {
  if (preferred !== null && !taken.has(preferred) && listen(preferred) === preferred) return preferred;
  for (let attempt = 0; attempt < PORT_ATTEMPTS; attempt++) {
    const port = listen(0);
    if (port !== null && !taken.has(port)) return port;
  }
  throw new DomainError('service_port_unavailable', 'Shinsa could not find a free port for the service.');
}

export type ForegroundReader = (pid: number) => Promise<string | null>;

async function readProcessField(field: string, pid: number) {
  const child = Bun.spawn(['ps', '-o', `${field}=`, '-p', String(pid)], { stdout: 'pipe', stderr: 'ignore' });
  const [text] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  return text.trim();
}

export async function readForegroundProgram(pid: number) {
  const group = Number(await readProcessField('tpgid', pid));
  if (!Number.isInteger(group) || group <= 0 || group === pid) return null;
  const command = await readProcessField('comm', group);
  return command.split('/').pop()?.replace(/^-/, '') || 'a program';
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

const KILL_DELAY_MS = 3_000;

export function spawnTerminalProcess(command: string[], options: TerminalSpawnOptions): TerminalProcess {
  const child = Bun.spawn(command, {
    cwd: options.cwd,
    env: options.env,
    terminal: {
      cols: options.cols,
      rows: options.rows,
      name: 'xterm-256color',
      data: (_terminal, data) => options.onData(data),
    },
  });
  const terminal = child.terminal;
  const signal = (name: NodeJS.Signals) => {
    if (child.exitCode === null && child.signalCode === null) child.kill(name);
  };
  return {
    pid: child.pid,
    write: (data) => {
      if (!terminal?.closed) terminal?.write(data);
    },
    resize: (cols, rows) => {
      if (!terminal?.closed) terminal?.resize(cols, rows);
    },
    hangUp: () => {
      signal('SIGHUP');
      terminal?.close();
      void Promise.race([child.exited, Bun.sleep(KILL_DELAY_MS)]).then(() => signal('SIGKILL'));
    },
    exited: child.exited,
  };
}
