import { Effect, Exit, Scope } from 'effect';
import type { CodexClientOptions, CodexConnection, CodexParams } from './client/schema.ts';
import { makeCodexClient } from './client/service.ts';

export { CodexRequestError } from './client/schema.ts';

type NotificationHandler = (method: string, params: CodexParams) => void;

type RequestHandler = (method: string, params: CodexParams) => Promise<unknown>;

export function readRecord(value: unknown): CodexParams {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as CodexParams) : {};
}

export function readText(record: CodexParams, key: string) {
  const value = record[key];
  return typeof value === 'string' ? value : '';
}

export class CodexClient {
  readonly #connection: CodexConnection;
  readonly #exitHandlers: ((message: string) => void)[] = [];
  #notify: NotificationHandler = () => undefined;
  #request: RequestHandler | null = null;
  readonly exited: Promise<void>;

  constructor(options: CodexClientOptions) {
    const scope = Effect.runSync(Scope.make());
    this.#connection = Effect.runSync(
      makeCodexClient(options, {
        notification: (method, params) => this.#notify(method, params),
        request: (method, params) => this.#request?.(method, params) ?? null,
        exit: (message) => {
          for (const handler of this.#exitHandlers) handler(message);
        },
      }).pipe(Scope.provide(scope))
    );
    this.exited = Effect.runPromise(Effect.ensuring(this.#connection.exited, Scope.close(scope, Exit.void)));
  }

  get pid() {
    return this.#connection.pid;
  }

  onNotification(handler: NotificationHandler) {
    this.#notify = handler;
  }

  onRequest(handler: RequestHandler) {
    this.#request = handler;
  }

  onExit(handler: (message: string) => void) {
    this.#exitHandlers.push(handler);
  }

  initialize() {
    return Effect.runPromise(this.#connection.initialize);
  }

  request<T = CodexParams>(method: string, params: CodexParams): Promise<T> {
    return Effect.runPromise(this.#connection.request(method, params)) as Promise<T>;
  }

  close() {
    Effect.runSync(this.#connection.close);
  }
}
