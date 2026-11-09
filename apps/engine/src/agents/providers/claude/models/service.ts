import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { KNOWN_AGENT_MODELS } from '@shinsa/core';
import { Cache, Duration, Effect, Exit, Stream } from 'effect';
import { describeError } from '../../../../log/index.ts';
import { resolveClaudeLaunch } from '../sdk/launch.ts';
import { resolveModels } from './families.ts';
import { type ModelCatalogDefinition, type ModelCatalogHandle, ModelsUnavailable } from './schema.ts';

export const makeModelCatalog = Effect.fn('ModelCatalog.make')(function* (
  definition: ModelCatalogDefinition
) {
  const { runtime, timeout, timeToLive } = definition;
  const unavailable = (error: unknown) => new ModelsUnavailable({ message: describeError(error) });

  const request = Effect.gen(function* () {
    const launch = yield* resolveClaudeLaunch(runtime.resolveExecutable);
    const controller = new AbortController();
    const session = yield* Effect.try({
      try: () =>
        runtime.runQuery({
          prompt: Stream.toAsyncIterable<SDKUserMessage, never>(Stream.never),
          options: { settingSources: [], abortController: controller, ...launch.options },
        }),
      catch: unavailable,
    });
    const rows = yield* Effect.tryPromise({ try: () => session.supportedModels(), catch: unavailable }).pipe(
      Effect.timeoutOrElse({
        duration: timeout,
        orElse: () => new ModelsUnavailable({ message: 'The agent did not list its models in time.' }),
      }),
      Effect.ensuring(Effect.sync(() => controller.abort()))
    );
    const models = resolveModels(rows);
    if (models.length === 0)
      return yield* new ModelsUnavailable({ message: 'The agent reported no models.' });
    return models;
  });

  const catalog = yield* Cache.makeWith((_version: string) => request, {
    capacity: 1,
    timeToLive: (exit) => (Exit.isSuccess(exit) ? timeToLive : Duration.zero),
  });

  const list = runtime.resolveExecutable.pipe(
    Effect.flatMap((executable) =>
      Cache.get(catalog, executable.ok ? `${executable.path}@${executable.version ?? ''}` : '')
    ),
    Effect.catch((failure) =>
      Effect.logWarning('[Models] Falling back to the built-in list').pipe(
        Effect.annotateLogs({ error: failure.message }),
        Effect.as(KNOWN_AGENT_MODELS)
      )
    )
  );

  const handle: ModelCatalogHandle = { list };
  return handle;
});
