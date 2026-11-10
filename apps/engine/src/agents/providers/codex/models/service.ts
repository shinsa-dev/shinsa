import { type AgentModel, KNOWN_CODEX_MODELS } from '@shinsa/core';
import { Cache, Duration, Effect, Exit, Option, Ref } from 'effect';
import type { CodexParams } from '../client/schema.ts';
import { makeCodexClient } from '../client/service.ts';
import { CodexCallFailed } from '../complete/schema.ts';
import { resolveCodexModels } from './rows.ts';
import { type CodexModelCatalogHandle, type CodexModelsDefinition, MAX_PAGES, NO_MODELS } from './schema.ts';

export const makeCodexModelCatalog = Effect.fn('CodexModelCatalog.make')(function* (
  definition: CodexModelsDefinition
) {
  const requestRows = Effect.fn('CodexModelCatalog.requestRows')(function* () {
    const executable = yield* definition.executable;
    if (!executable.ok) return yield* new CodexCallFailed({ message: executable.message });
    const connection = yield* makeCodexClient({
      path: executable.path,
      cwd: definition.cwd,
      env: definition.env,
    });
    yield* connection.initialize;
    const rows: unknown[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const response = (yield* connection.request('model/list', cursor ? { cursor } : {})) as CodexParams;
      if (Array.isArray(response.data)) rows.push(...response.data);
      cursor = typeof response.nextCursor === 'string' && response.nextCursor ? response.nextCursor : null;
      if (!cursor) break;
    }
    return rows;
  });

  const requestModels = Effect.gen(function* () {
    const models = resolveCodexModels(
      yield* requestRows().pipe(
        Effect.timeoutOrElse({
          duration: definition.timeout,
          orElse: () =>
            Effect.fail(new CodexCallFailed({ message: 'Codex did not list its models in time.' })),
        }),
        Effect.scoped
      )
    );
    if (models.length === 0) return yield* new CodexCallFailed({ message: NO_MODELS });
    return models;
  });

  const catalog = yield* Cache.makeWith((_version: string) => requestModels, {
    capacity: 1,
    timeToLive: (exit) => (Exit.isSuccess(exit) ? definition.timeToLive : Duration.zero),
  });

  const lastGood = yield* Ref.make(Option.none<AgentModel[]>());

  const list = definition.executable.pipe(
    Effect.flatMap((executable) =>
      Cache.get(catalog, executable.ok ? `${executable.path}@${executable.version ?? ''}` : '')
    ),
    Effect.tap((models) => Ref.set(lastGood, Option.some(models))),
    Effect.catch((failure) =>
      Effect.logWarning('[Models] Falling back to the built-in Codex list').pipe(
        Effect.annotateLogs({ error: failure.message }),
        Effect.andThen(Ref.get(lastGood)),
        Effect.map(Option.getOrElse(() => KNOWN_CODEX_MODELS))
      )
    )
  );

  const handle: CodexModelCatalogHandle = { list };
  return handle;
});
