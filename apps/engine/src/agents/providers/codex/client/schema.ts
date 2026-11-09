import type { Effect } from 'effect';
import { Schema } from 'effect';

export class CodexRequestError extends Schema.TaggedError<
  CodexRequestError,
  { readonly brand: unique symbol }
>()('CodexRequestError', { method: Schema.String, message: Schema.String }) {}

export const CodexMessage = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown));

export type CodexParams = Record<string, unknown>;

export type CodexRequestId = string | number;

export interface CodexClientOptions {
  readonly path: string;
  readonly cwd: string;
  readonly env?: Record<string, string | undefined>;
  readonly browserEndpoint?: string | null;
}

export interface CodexHandlers {
  readonly notification: (method: string, params: CodexParams) => void;
  readonly request: (method: string, params: CodexParams) => Promise<unknown> | null;
  readonly exit: (message: string) => void;
}

export interface CodexConnection {
  readonly pid: number;
  readonly request: (method: string, params: CodexParams) => Effect.Effect<unknown, CodexRequestError>;
  readonly initialize: Effect.Effect<void, CodexRequestError>;
  readonly close: Effect.Effect<void>;
  readonly exited: Effect.Effect<void>;
}

export const STDERR_LINES = 20;

export const STDERR_LINE_CHARS = 2_000;

export const STOPPED = 'Codex’s app server has stopped.';

export const CLOSED = 'Codex’s app server was stopped.';

export const REFUSED = 'Codex refused the request.';

export const INTERNAL_ERROR = -32000;

export const NO_HANDLER = 'No handler for this request.';

export const CLIENT_INFO = { name: 'shinsa', title: 'Shinsa', version: '0.1.0' };
