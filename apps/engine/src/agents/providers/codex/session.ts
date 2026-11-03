import { Duration, Effect, Exit, Scope } from 'effect';
import { edgeRuntime } from '../../../runtime/edge.ts';
import type { AgentSession, AgentSessionInput } from '../types.ts';
import { resolveCodexExecutable } from './executable.ts';
import { HEARTBEAT_MS } from './mcp/schema.ts';
import {
  COMPACT_GRACE,
  type CodexRuntime,
  type CodexSessionMode,
  type CodexSessionOptions,
  REQUEST_TIMEOUT,
} from './session/schema.ts';
import { makeCodexSession } from './session/service.ts';

export type { CodexRuntime, CodexSessionMode, CodexSessionOptions } from './session/schema.ts';

export const CODEX_RUNTIME: CodexRuntime = { resolveExecutable: () => resolveCodexExecutable() };

export function startCodexSession(
  input: AgentSessionInput,
  options: CodexSessionOptions = {},
  mode: CodexSessionMode = 'turns'
): AgentSession {
  const runtime = options.runtime ?? CODEX_RUNTIME;
  const now = options.now ?? Date.now;
  const scope = edgeRuntime.runSync(Scope.make());
  const handle = edgeRuntime.runSync(
    makeCodexSession({
      input,
      mode,
      executable: Effect.promise(() => runtime.resolveExecutable()),
      env: runtime.env,
      now: Effect.sync(now),
      requestTimeout:
        options.requestTimeoutMs === undefined ? REQUEST_TIMEOUT : Duration.millis(options.requestTimeoutMs),
      compactGrace:
        options.compactGraceMs === undefined ? COMPACT_GRACE : Duration.millis(options.compactGraceMs),
      heartbeat: Duration.millis(options.heartbeatMs ?? HEARTBEAT_MS),
      token: Effect.sync(() => crypto.randomUUID()),
    }).pipe(Scope.provide(scope))
  );
  return {
    done: edgeRuntime.runPromise(handle.done.pipe(Effect.ensuring(Scope.close(scope, Exit.void)))),
    steer: (text, from = 'you') => edgeRuntime.runSync(handle.steer(text, from)),
    cancel: () => edgeRuntime.runPromise(handle.cancel),
  };
}
