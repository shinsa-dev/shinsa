import type { ChatEvent } from '@shinsa/core';
import { Context, Effect, Layer, Scope } from 'effect';
import { type FileWatcher, TranscriptWatch } from '../../src/agents/transcripts/schema.ts';
import { Transcripts } from '../../src/agents/transcripts/service.ts';
import type { ServerConfig } from '../../src/config/index.ts';
import { EngineConfig } from '../../src/config/service.ts';

export function createTranscriptsLayer(dir: string, watch?: FileWatcher) {
  return Transcripts.layer.pipe(
    Layer.provide(
      Layer.merge(
        Layer.succeed(EngineConfig, { transcriptsDir: dir } as ServerConfig),
        watch ? Layer.succeed(TranscriptWatch, watch) : Layer.empty
      )
    )
  );
}

export function createTestTranscripts(dir: string, watch?: FileWatcher): Transcripts['Service'] {
  return Effect.runSync(
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      return Context.get(yield* Layer.buildWithScope(createTranscriptsLayer(dir, watch), scope), Transcripts);
    })
  );
}

export function createSyncTranscripts(dir: string) {
  const service = createTestTranscripts(dir);
  return {
    service,
    resolvePath: service.resolvePath,
    record: (runId: string, event: ChatEvent) => Effect.runSync(service.record(runId, event)),
    listEntries: (runId: string) => Effect.runSync(service.listEntries(runId)),
    readEntries: (runId: string, from: number) => Effect.runSync(service.readEntries(runId, from)),
  };
}

export type SyncTranscripts = ReturnType<typeof createSyncTranscripts>;
