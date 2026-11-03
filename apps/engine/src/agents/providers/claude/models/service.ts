import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { KNOWN_AGENT_MODELS } from '@shinsa/core';
import { Duration, Effect, Stream } from 'effect';
import { describeError } from '../../../../log/index.ts';
import { resolveClaudeLaunch } from '../sdk/service.ts';
import { resolveModels } from './families.ts';
import { type ModelCatalogDefinition, type ModelCatalogHandle, ModelsUnavailable } from './schema.ts';

export const makeModelCatalog = Effect.fn('ModelCatalog.make')(function* (
  definition: ModelCatalogDefinition
) {
  const { runtime, timeout } = definition;
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

  const [cached, invalidate] = yield* Effect.cachedInvalidateWithTTL(request, Duration.infinity);

  const list = cached.pipe(
    Effect.catch((failure) =>
      Effect.logWarning('[Models] Falling back to the built-in list').pipe(
        Effect.annotateLogs({ error: failure.message }),
        Effect.andThen(invalidate),
        Effect.as(KNOWN_AGENT_MODELS)
      )
    )
  );

  const handle: ModelCatalogHandle = { list };
  return handle;
});
