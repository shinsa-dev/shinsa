import { Effect, Exit, Scope } from 'effect';
import { edgeRuntime } from '../../../runtime/edge.ts';
import type { AgentSession, AgentSessionInput } from '../types.ts';
import type { ClaudeSessionOptions } from './session/schema.ts';
import { makeClaudeSession } from './session/service.ts';

export type { ClaudeSessionOptions } from './session/schema.ts';

export function startClaudeSession(
  input: AgentSessionInput,
  options: ClaudeSessionOptions = {}
): AgentSession {
  const scope = edgeRuntime.runSync(Scope.make());
  const handle = edgeRuntime.runSync(makeClaudeSession(input, options).pipe(Scope.provide(scope)));
  return {
    done: edgeRuntime.runPromise(handle.done.pipe(Effect.ensuring(Scope.close(scope, Exit.void)))),
    hasPendingBackgroundWork: () => edgeRuntime.runSync(handle.hasPendingBackgroundWork),
    loadMcpServers: (servers, abandoned) => edgeRuntime.runPromise(handle.loadMcpServers(servers, abandoned)),
    steer: (text, from = 'you') => edgeRuntime.runSync(handle.steer(text, from)),
    cancel: () => edgeRuntime.runPromise(handle.cancel),
  };
}
