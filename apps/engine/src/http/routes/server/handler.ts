import { resolveQueueSummary } from '@shinsa/core';
import { EngineApi } from '@shinsa/core/engine-api';
import { RequestFailed } from '@shinsa/core/engine-api/schema';
import { Clock, Effect } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { createServerInstance, resolveEngineActivity, resolveHealth } from '../../../instance/index.ts';
import { requestPromise } from '../../failures.ts';
import { HttpServices } from '../../services/service.ts';
import { KNOWN_PROVIDERS, RESTART_UNSUPPORTED } from './schema.ts';

export const ServerHandlers = HttpApiBuilder.group(
  EngineApi,
  'server',
  Effect.fn('ServerHandlers')(function* (handlers) {
    const { engine, config, models, providers, restarter, instance: given } = yield* HttpServices;
    const instance = given ?? createServerInstance(null, yield* Clock.currentTimeMillis);

    return handlers
      .handle('health', () =>
        Effect.map(Clock.currentTimeMillis, (now) =>
          resolveHealth(
            { seq: engine.state.seq, problems: engine.problems },
            config.dataDir,
            instance,
            resolveEngineActivity(engine.state, restarter),
            now
          )
        )
      )
      .handle('restart', ({ payload }) =>
        restarter
          ? requestPromise(() => restarter.request(payload.when))
          : Effect.fail(new RequestFailed(RESTART_UNSUPPORTED))
      )
      .handle('models', () => requestPromise(() => models.listModels()))
      .handle('providers', () =>
        providers ? requestPromise(() => providers.listProviders()) : Effect.succeed(KNOWN_PROVIDERS)
      )
      .handle('queue', ({ request }) =>
        Effect.map(Clock.currentTimeMillis, (now) =>
          resolveQueueSummary(engine.state, now, new URL(request.originalUrl).origin)
        )
      );
  })
);
