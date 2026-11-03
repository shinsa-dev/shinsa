import type { Duration, Effect } from 'effect';
import { Schema } from 'effect';
import type { UsageRequester } from '../../../../accounts/usage.ts';
import type { CodexExecutable } from '../executable/schema.ts';

export interface CodexUsageOptions {
  requestHttp?: UsageRequester;
  env?: Record<string, string | undefined>;
  now?: () => number;
  timeoutMs?: number;
}

export interface RawWindow {
  usedPercent: number;
  minutes: number;
  resetsAt: number | null;
}

export interface CodexOAuthLogin {
  readonly accessToken: string;
  readonly accountId: string | null;
}

export class CodexUsageUnreachable extends Schema.TaggedError<
  CodexUsageUnreachable,
  { readonly brand: unique symbol }
>()('CodexUsageUnreachable', { message: Schema.String }) {}

export const CodexAuthFile = Schema.fromJsonString(
  Schema.Struct({ tokens: Schema.Record(Schema.String, Schema.Unknown) })
);

export interface CodexUsageDefinition {
  readonly home: string;
  readonly now: Effect.Effect<number>;
  readonly requestHttp: (url: string, init: RequestInit) => Effect.Effect<Response, CodexUsageUnreachable>;
  readonly executable: Effect.Effect<CodexExecutable>;
  readonly env: Record<string, string | undefined> | undefined;
  readonly cwd: string;
  readonly timeout: Duration.Duration;
}

export const DEFAULT_BASE_URL = 'https://chatgpt.com/backend-api';

export const USAGE_TIMEOUT_MS = 10_000;

const SESSION_MINUTES = 300;

const WEEK_MINUTES = 10_080;

export const MAIN_LIMIT = 'codex';

export const SIGNED_OUT = 'Codex is signed out. Run `codex login` in a terminal.';

export const NOT_CHATGPT = 'Codex reports usage limits only when it is signed in with ChatGPT.';

export const CODEX_WINDOW_KEYS: Record<number, string> = {
  [SESSION_MINUTES]: 'five_hour',
  [WEEK_MINUTES]: 'seven_day',
};
