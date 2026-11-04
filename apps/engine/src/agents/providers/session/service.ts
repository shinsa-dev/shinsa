import { Deferred, Effect, type Scope } from 'effect';
import type { AgentSession, AgentSessionResult } from '../types.ts';
import type { ScopedAgentSession } from './schema.ts';

export const acquireAgentSession = Effect.fn('AgentSession.acquire')(function* (
  start: Effect.Effect<AgentSession, never, Scope.Scope>
) {
  const result = yield* Deferred.make<AgentSessionResult>();
  const session = yield* Effect.acquireRelease(start, (started) =>
    Effect.flatMap(Deferred.isDone(result), (finished) =>
      finished
        ? Effect.void
        : started.cancel.pipe(
            Effect.andThen(started.done),
            Effect.flatMap((ended) => Deferred.succeed(result, ended)),
            Effect.ignoreCause
          )
    )
  );
  yield* Effect.forkScoped(session.done.pipe(Effect.flatMap((ended) => Deferred.succeed(result, ended))));
  const scoped: ScopedAgentSession = { session, done: Deferred.await(result) };
  return scoped;
});
