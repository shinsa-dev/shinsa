import { Context, Effect, Layer, Scope } from 'effect';
import { Transcripts } from '../../apps/engine/src/agents/transcripts/service.ts';
import type { ServerConfig } from '../../apps/engine/src/config/index.ts';
import { EngineConfig } from '../../apps/engine/src/config/service.ts';
import type { ChatEvent } from '../../packages/core/src/index.ts';

export function createTranscripts(transcriptsDir: string): Transcripts['Service'] {
  const layer = Transcripts.layer.pipe(
    Layer.provide(Layer.succeed(EngineConfig, { transcriptsDir } as ServerConfig))
  );
  return Effect.runSync(
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      return Context.get(yield* Layer.buildWithScope(layer, scope), Transcripts);
    })
  );
}

export function recordTranscript(transcripts: Transcripts['Service'], runId: string, event: ChatEvent) {
  Effect.runSync(transcripts.record(runId, event));
}

export function createPlainTranscripts(transcriptsDir: string) {
  const service = createTranscripts(transcriptsDir);
  return {
    service,
    listEntries: (runId: string) => Effect.runSync(service.listEntries(runId)),
    record: (runId: string, event: ChatEvent) => recordTranscript(service, runId, event),
    follow: (runId: string) => {
      const unfollow = Effect.runSync(service.follow(runId));
      return () => Effect.runSync(unfollow);
    },
    subscribe: (listener: Parameters<Transcripts['Service']['subscribe']>[0]) => {
      const unsubscribe = Effect.runSync(service.subscribe(listener));
      return () => Effect.runSync(unsubscribe);
    },
  };
}
