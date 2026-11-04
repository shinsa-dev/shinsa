import { Effect, FiberMap, Ref, Scope } from 'effect';
import type { AgentSession } from '../providers/index.ts';
import type { IdleEntry, IdleReleaseDefinition, IdleReleaseHandle } from './schema.ts';

export const makeIdleRelease = Effect.fn('IdleRelease.make')(function* (definition: IdleReleaseDefinition) {
  const scope = yield* Scope.Scope;
  const entries = yield* Ref.make<ReadonlyMap<string, IdleEntry>>(new Map());
  const timers = yield* FiberMap.make<string>();

  const selectEntry = (runId: string) => Effect.map(Ref.get(entries), (current) => current.get(runId));

  const writeEntry = (runId: string, entry: IdleEntry) =>
    Ref.update(entries, (current) => new Map(current).set(runId, entry));

  const forget = Effect.fn('IdleRelease.forget')(function* (runId: string) {
    yield* FiberMap.remove(timers, runId);
    yield* Ref.update(entries, (current) => {
      const next = new Map(current);
      next.delete(runId);
      return next;
    });
  });

  const releaseIfIdle = Effect.fn('IdleRelease.releaseIfIdle')(function* (
    runId: string,
    session: AgentSession
  ) {
    for (;;) {
      yield* Effect.sleep(definition.idle);
      const entry = yield* selectEntry(runId);
      if (!entry || entry.session !== session || entry.waits === 0) return;
      if (session.hasPendingBackgroundWork && (yield* session.hasPendingBackgroundWork)) {
        const now = yield* definition.now;
        const pinnedSince = entry.pinnedSince ?? now;
        if (now - pinnedSince < definition.maxPinMs) {
          yield* writeEntry(runId, { ...entry, pinnedSince });
          continue;
        }
      }
      yield* Ref.update(entries, (current) => {
        const next = new Map(current);
        next.delete(runId);
        return next;
      });
      yield* Effect.forkIn(definition.release(runId, session), scope);
      return;
    }
  });

  const arm = (runId: string, session: AgentSession): Effect.Effect<void> =>
    FiberMap.run(timers, runId, releaseIfIdle(runId, session), { startImmediately: true }).pipe(
      Effect.asVoid
    );

  const endWait = Effect.fn('IdleRelease.endWait')(function* (runId: string, session: AgentSession) {
    const entry = yield* selectEntry(runId);
    if (!entry || entry.session !== session) return;
    if (entry.waits > 1) {
      yield* writeEntry(runId, { ...entry, waits: entry.waits - 1 });
      return;
    }
    yield* forget(runId);
  });

  const wait = Effect.fn('IdleRelease.wait')(function* (runId: string, session: AgentSession) {
    const entry = yield* selectEntry(runId);
    yield* writeEntry(runId, {
      session,
      waits: entry?.session === session ? entry.waits + 1 : 1,
      pinnedSince: null,
    });
    yield* arm(runId, session);
    const ended = yield* Ref.make(false);
    return Effect.flatMap(Ref.getAndSet(ended, true), (already) =>
      already ? Effect.void : endWait(runId, session)
    );
  });

  const isWaiting = (runId: string, session: AgentSession) =>
    Effect.map(selectEntry(runId), (entry) => entry?.session === session);

  const touch = Effect.fn('IdleRelease.touch')(function* (runId: string) {
    const entry = yield* selectEntry(runId);
    if (!entry || entry.waits === 0) return;
    yield* writeEntry(runId, { ...entry, pinnedSince: null });
    yield* arm(runId, entry.session);
  });

  const handle: IdleReleaseHandle = { wait, isWaiting, touch, forget };
  return handle;
});
