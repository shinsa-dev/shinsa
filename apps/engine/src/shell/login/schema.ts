import { Duration } from 'effect';
import type { Effect } from 'effect';
import type { Argv, CommandResult } from '../schema.ts';

export type Env = Record<string, string | undefined>;

type ShellRunner = (command: string[], cwd: string) => Promise<CommandResult>;

export interface LoginEnvOptions {
  shell?: string;
  home?: string;
  timeoutMs?: number;
  run?: ShellRunner;
}

export interface TerminalStreams {
  stdin: { isTTY?: boolean };
  stdout: { isTTY?: boolean };
}

export interface LoginEnvReader {
  read: () => Promise<Record<string, string> | null>;
}

export interface LoginEnvDefinition {
  readonly shell: string;
  readonly home: string;
  readonly env: Env;
  readonly timeout: Duration.Duration;
  readonly run: ((argv: Argv, cwd: string) => Effect.Effect<CommandResult>) | null;
}

export const LOGIN_MARKER = '__SHINSA_LOGIN_ENV__';

export const LOGIN_TIMEOUT = Duration.seconds(5);

export const LOGIN_SHELL_ENV = { DISABLE_AUTO_UPDATE: 'true' };

export const SKIPPED_KEYS: ReadonlySet<string> = new Set([
  'PWD',
  'OLDPWD',
  'SHLVL',
  '_',
  'DISABLE_AUTO_UPDATE',
]);
