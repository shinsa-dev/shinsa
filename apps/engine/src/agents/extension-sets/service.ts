import type { LoadedExtensions } from '@shinsa/core';
import { Context, Effect, Layer } from 'effect';
import { EngineCore } from '../../runtime/engine/service.ts';
import { Transcripts } from '../transcripts/service.ts';

export class SessionExtensionSets extends Context.Service<
  SessionExtensionSets,
  {
    select(sessionId: string): Effect.Effect<LoadedExtensions | null>;
    record(sessionId: string, loaded: LoadedExtensions): Effect.Effect<void>;
  }
>()('shinsa/engine/agents/extension-sets/SessionExtensionSets') {
  static readonly layer = Layer.effect(
    SessionExtensionSets,
    Effect.gen(function* () {
      const transcripts = yield* Transcripts;
      const engine = yield* EngineCore;
      const known = new Map<string, LoadedExtensions>();

      const readAnnounced = Effect.fn('SessionExtensionSets.readAnnounced')(function* (sessionId: string) {
        const runs = Object.values((yield* engine.state).runs)
          .filter((run) => run.sessionId === sessionId)
          .sort((left, right) => right.startedAt - left.startedAt);
        for (const run of runs) {
          const announced = (yield* transcripts.listEntries(run.id))
            .flatMap((entry) =>
              entry.type === 'notice' && entry.notice.kind === 'extensions' ? [entry.notice] : []
            )
            .at(-1);
          if (announced) {
            const { servers, skills, plugins, deferred = [] } = announced;
            const loaded: LoadedExtensions = { servers, skills, plugins, deferred };
            return loaded;
          }
        }
        return null;
      });

      const select = Effect.fn('SessionExtensionSets.select')(function* (sessionId: string) {
        const found = known.get(sessionId) ?? (yield* readAnnounced(sessionId));
        if (found) known.set(sessionId, found);
        return found;
      });

      const record = (sessionId: string, loaded: LoadedExtensions) =>
        Effect.sync(() => {
          known.set(sessionId, loaded);
        });

      return SessionExtensionSets.of({ select, record });
    })
  );
}
