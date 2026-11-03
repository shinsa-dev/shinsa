import { Effect } from 'effect';
import { describeError } from '../log/index.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import { spawnTerminalProcess } from '../terminals/pty.ts';
import {
  type AccountLoginsHandle,
  type AccountLoginsOptions,
  LoginExitFailed,
  LoginFinishFailed,
  type LoginProcess,
  type LoginSpawnOptions,
  LoginSpawnFailed,
  type LoginStart,
} from './login/schema.ts';
import { makeAccountLogins } from './login/service.ts';
import { LOGIN_COLUMNS, LOGIN_ROWS, LOGIN_TIMERS } from './schema.ts';

export type {
  AccountLoginsOptions,
  LoginFinisher,
  LoginProcess,
  LoginSpawner,
  LoginSpawnOptions,
  LoginStart,
  LoginTimers,
} from './login/schema.ts';
export { parseLoginUrl } from './login/transcript.ts';

export class AccountLogins {
  readonly #handle: AccountLoginsHandle;

  constructor(options: AccountLoginsOptions) {
    const newId = options.newId ?? (() => crypto.randomUUID());
    this.#handle = edgeRuntime.runSync(
      makeAccountLogins({
        spawn: (command, spawnOptions) =>
          Effect.try({
            try: () => {
              const child = options.spawn(command, {
                cwd: spawnOptions.cwd,
                env: spawnOptions.env,
                onData: (text) => edgeRuntime.runSync(spawnOptions.onData(text)),
              });
              return {
                write: (data: string) => Effect.sync(() => child.write(data)),
                kill: Effect.sync(() => child.kill()),
                exited: Effect.tryPromise({
                  try: () => child.exited,
                  catch: (error) => new LoginExitFailed({ message: describeError(error) }),
                }),
              };
            },
            catch: (error) => new LoginSpawnFailed({ message: describeError(error) }),
          }),
        finish: (accountId, loginId) =>
          Effect.tryPromise({
            try: () => options.finish(accountId, loginId),
            catch: (error) => new LoginFinishFailed({ message: describeError(error) }),
          }),
        changed: Effect.sync(options.onChange),
        ended: (login) => Effect.sync(() => options.onEnded?.(login)),
        now: Effect.sync(options.now ?? Date.now),
        newId: Effect.sync(newId),
        timers: { ...LOGIN_TIMERS, ...options.timers },
      })
    );
  }

  current() {
    return edgeRuntime.runSync(this.#handle.current);
  }

  start(start: LoginStart) {
    return edgeRuntime.runSync(this.#handle.start(start));
  }

  submitCode(loginId: string, code: string) {
    return edgeRuntime.runSync(this.#handle.submitCode(loginId, code));
  }

  cancel(loginId: string) {
    return edgeRuntime.runSync(this.#handle.cancel(loginId));
  }

  clear(loginId: string) {
    edgeRuntime.runSync(this.#handle.clear(loginId));
  }

  stop() {
    edgeRuntime.runSync(this.#handle.stop);
  }
}

export function spawnLoginTerminal(command: string[], options: LoginSpawnOptions): LoginProcess {
  const decoder = new TextDecoder();
  const child = spawnTerminalProcess(command, {
    cwd: options.cwd,
    cols: LOGIN_COLUMNS,
    rows: LOGIN_ROWS,
    env: { ...Bun.env, ...options.env, TERM: 'xterm-256color' },
    onData: (data) => options.onData(decoder.decode(data, { stream: true })),
  });
  return { write: child.write, kill: child.hangUp, exited: child.exited };
}
