import { Context, Effect, Layer, Scope } from 'effect';
import { Transcripts } from '../../apps/engine/src/agents/transcripts/service.ts';
import type { ServerConfig } from '../../apps/engine/src/config/index.ts';
import { EngineConfig } from '../../apps/engine/src/config/service.ts';

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
