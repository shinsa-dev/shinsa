import { Deferred, Effect } from 'effect';
import type { AgentSession, AgentSessionResult } from '../types.ts';
import type { ScopedAgentSession } from './schema.ts';

export const acquireAgentSession = Effect.fn('AgentSession.acquire')(function* (start: () => AgentSession) {
  const result = yield* Deferred.make<AgentSessionResult>();
  const session = yield* Effect.acquireRelease(Effect.sync(start), (started) =>
    Effect.flatMap(Deferred.isDone(result), (finished) =>
      finished
        ? Effect.void
        : Effect.promise(() => started.cancel()).pipe(
            Effect.andThen(Effect.promise(() => started.done)),
            Effect.ignoreCause
          )
    )
  );
  yield* Effect.forkScoped(
    Effect.promise(() => session.done).pipe(Effect.flatMap((ended) => Deferred.succeed(result, ended)))
  );
  const scoped: ScopedAgentSession = { session, done: Deferred.await(result) };
  return scoped;
});
