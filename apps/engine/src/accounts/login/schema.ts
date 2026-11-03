import type { AccountLogin } from '@shinsa/core';
import { Schema } from 'effect';
import type { Effect, Fiber } from 'effect';
import type { Env } from '../paths.ts';

export interface LoginProcess {
  write: (data: string) => void;
  kill: () => void;
  exited: Promise<number>;
}

export interface LoginSpawnOptions {
  cwd: string;
  env: Env;
  onData: (text: string) => void;
}

export type LoginSpawner = (command: string[], options: LoginSpawnOptions) => LoginProcess;

export type LoginOutcome = { ok: true; email: string | null } | { ok: false; message: string };

export type LoginFinisher = (accountId: string, loginId: string) => Promise<LoginOutcome>;

export interface LoginTimers {
  menuFallbackMs: number;
  urlTimeoutMs: number;
  watchdogMs: number;
}

export interface AccountLoginsOptions {
  spawn: LoginSpawner;
  finish: LoginFinisher;
  onChange: () => void;
  onEnded?: (login: AccountLogin) => void;
  now?: () => number;
  newId?: () => string;
  timers?: Partial<LoginTimers>;
}

export interface LoginStart {
  accountId: string;
  claude: string;
  cwd: string;
  env: Env;
  email: string | null;
}

export const TRANSCRIPT_LIMIT = 16_384;

// oxlint-disable-next-line eslint/no-control-regex -- terminal links start with an escape character
export const OSC_LINK = /\u001b]8;[^;]*;([^\u0007\u001b]*)(?:\u0007|\u001b\\)/g;

// oxlint-disable-next-line eslint/no-control-regex -- terminal escape sequences start with an escape character
export const ESCAPES = /\u001b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-Z\\-_])/g;

export const URL_PATTERN = /https:\/\/[^\s"'<>]+/g;

export const KEYCHAIN_HINT =
  'On a Mac the keychain may need your approval the first time. Run `claude auth login` in a terminal once, then try again.';

export class LoginSpawnFailed extends Schema.TaggedError<
  LoginSpawnFailed,
  { readonly brand: unique symbol }
>()('LoginSpawnFailed', { message: Schema.String }) {}

export class LoginExitFailed extends Schema.TaggedError<LoginExitFailed, { readonly brand: unique symbol }>()(
  'LoginExitFailed',
  { message: Schema.String }
) {}

export class LoginFinishFailed extends Schema.TaggedError<
  LoginFinishFailed,
  { readonly brand: unique symbol }
>()('LoginFinishFailed', { message: Schema.String }) {}

export interface LoginTerminal {
  readonly write: (data: string) => Effect.Effect<void>;
  readonly kill: Effect.Effect<void>;
  readonly exited: Effect.Effect<number, LoginExitFailed>;
}

interface LoginTerminalOptions {
  readonly cwd: string;
  readonly env: Env;
  readonly onData: (text: string) => Effect.Effect<void>;
}

export interface AccountLoginsDefinition {
  readonly spawn: (
    command: string[],
    options: LoginTerminalOptions
  ) => Effect.Effect<LoginTerminal, LoginSpawnFailed>;
  readonly finish: (accountId: string, loginId: string) => Effect.Effect<LoginOutcome, LoginFinishFailed>;
  readonly changed: Effect.Effect<void>;
  readonly ended: (login: AccountLogin) => Effect.Effect<void>;
  readonly now: Effect.Effect<number>;
  readonly newId: Effect.Effect<string>;
  readonly timers: LoginTimers;
}

export interface LoginFlow {
  readonly key: object;
  readonly login: AccountLogin;
  readonly terminal: LoginTerminal | null;
  readonly transcript: string;
  readonly codeSent: boolean;
  readonly fibers: readonly Fiber.Fiber<unknown, unknown>[];
}

export interface AccountLoginsHandle {
  readonly current: Effect.Effect<AccountLogin | null>;
  readonly start: (start: LoginStart) => Effect.Effect<AccountLogin>;
  readonly submitCode: (loginId: string, code: string) => Effect.Effect<boolean>;
  readonly cancel: (loginId: string) => Effect.Effect<boolean>;
  readonly clear: (loginId: string) => Effect.Effect<void>;
  readonly stop: Effect.Effect<void>;
}
