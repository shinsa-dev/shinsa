import { type AgentModel, KNOWN_CODEX_MODELS } from '@shinsa/core';
import { Effect, Option, SynchronizedRef } from 'effect';
import type { CodexParams } from '../client/schema.ts';
import { makeCodexClient } from '../client/service.ts';
import { CodexCallFailed } from '../complete/schema.ts';
import { resolveCodexModels } from './rows.ts';
import { type CodexModelCatalogHandle, type CodexModelsDefinition, MAX_PAGES, NO_MODELS } from './schema.ts';

export const makeCodexModelCatalog = Effect.fn('CodexModelCatalog.make')(function* (
  definition: CodexModelsDefinition
) {
  const catalog = yield* SynchronizedRef.make(Option.none<AgentModel[]>());

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

  const list = SynchronizedRef.modifyEffect(catalog, (cached) =>
    Option.match(cached, {
      onSome: (models) => Effect.succeed([models, cached] as const),
      onNone: () =>
        requestModels.pipe(
          Effect.map((models) => [models, Option.some(models)] as const),
          Effect.catch((failure) =>
            Effect.logWarning('[Models] Falling back to the built-in Codex list').pipe(
              Effect.annotateLogs({ error: failure.message }),
              Effect.as([KNOWN_CODEX_MODELS, cached] as const)
            )
          )
        ),
    })
  );

  const handle: CodexModelCatalogHandle = { list };
  return handle;
});
