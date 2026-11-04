import type { AccountLogin } from '@shinsa/core';
import { Context, Schema } from 'effect';
import type { Effect, Fiber } from 'effect';
import type { Env } from '../paths.ts';
import { LOGIN_TIMERS } from '../schema.ts';

export type LoginOutcome = { ok: true; email: string | null } | { ok: false; message: string };

export interface LoginTimers {
  menuFallbackMs: number;
  urlTimeoutMs: number;
  watchdogMs: number;
}

export const LoginTimerSettings = Context.Reference<LoginTimers>(
  'shinsa/engine/accounts/login/LoginTimerSettings',
  { defaultValue: (): LoginTimers => LOGIN_TIMERS }
);

export interface LoginStart {
  readonly accountId: string;
  readonly claude: string;
  readonly cwd: string;
  readonly env: Env;
  readonly email: string | null;
  readonly finish: (loginId: string) => Effect.Effect<LoginOutcome, LoginFinishFailed>;
  readonly ended: (login: AccountLogin) => Effect.Effect<void>;
}

export const TRANSCRIPT_LIMIT = 16_384;

// oxlint-disable-next-line eslint/no-control-regex -- terminal links start with an escape character
export const OSC_LINK = /\u001b]8;[^;]*;([^\u0007\u001b]*)(?:\u0007|\u001b\\)/g;

// oxlint-disable-next-line eslint/no-control-regex -- terminal escape sequences start with an escape character
export const ESCAPES = /\u001b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-Z\\-_])/g;

export const URL_PATTERN = /https:\/\/[^\s"'<>]+/g;

export const KEYCHAIN_HINT =
  'On a Mac the keychain may need your approval the first time. Run `claude auth login` in a terminal once, then try again.';

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

export interface LoginFlow {
  readonly key: object;
  readonly login: AccountLogin;
  readonly start: LoginStart;
  readonly terminal: LoginTerminal | null;
  readonly transcript: string;
  readonly codeSent: boolean;
  readonly fibers: readonly Fiber.Fiber<unknown, unknown>[];
}
