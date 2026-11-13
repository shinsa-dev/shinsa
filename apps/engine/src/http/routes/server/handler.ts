import { resolveQueueSummary } from '@shinsa/core';
import { EngineApi } from '@shinsa/core/engine-api';
import { RequestFailed } from '@shinsa/core/engine-api/schema';
import { Clock, Effect, Option } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { Accounts } from '../../../accounts/roster/service.ts';
import { Providers } from '../../../agents/providers/registry/service.ts';
import { EngineConfig } from '../../../config/service.ts';
import { createServerInstance, resolveEngineActivity, resolveHealth } from '../../../instance/index.ts';
import { EngineRestarter } from '../../../instance/restart/service.ts';
import { EngineCore } from '../../../runtime/engine/service.ts';
import { resolveRequestFailure } from '../../failures.ts';
import { EngineModels, ServedInstance } from '../../schema.ts';
import { KNOWN_PROVIDERS, RESTART_UNSUPPORTED } from './schema.ts';

export const ServerHandlers = HttpApiBuilder.group(
  EngineApi,
  'server',
  Effect.fn('ServerHandlers')(function* (handlers) {
    const engine = yield* EngineCore;
    const config = yield* EngineConfig;
    const models = yield* EngineModels;
    const providers = Option.getOrUndefined(yield* Effect.serviceOption(Providers));
    const accounts = Option.getOrUndefined(yield* Effect.serviceOption(Accounts));
    const listProviders = providers
      ? Effect.gen(function* () {
          const listed = yield* providers.listProviders;
          if (!accounts) return listed;
          const hidden = yield* accounts.listHiddenProviders;
          return listed.filter((provider) => !hidden.has(provider.id));
        })
      : Effect.succeed(KNOWN_PROVIDERS);
    const restarter = Option.getOrUndefined(yield* Effect.serviceOption(EngineRestarter));
    const given = yield* ServedInstance;
    const instance = given ?? createServerInstance(null, yield* Clock.currentTimeMillis);

    return handlers
      .handle(
        'health',
        Effect.fn('ServerHandlers.health')(function* () {
          const state = yield* engine.state;
          const activity = restarter ? restarter.activity : Effect.succeed(resolveEngineActivity(state));
          return resolveHealth(
            { seq: state.seq, problems: engine.problems },
            config.dataDir,
            instance,
            yield* activity,
            yield* Clock.currentTimeMillis
          );
        })
      )
      .handle('restart', ({ payload }) =>
        restarter
          ? restarter.request(payload.when).pipe(Effect.mapError(resolveRequestFailure))
          : Effect.fail(new RequestFailed(RESTART_UNSUPPORTED))
      )
      .handle('models', () => models.listModels)
      .handle('providers', () => listProviders)
      .handle('queue', ({ request }) =>
        Effect.zipWith(Clock.currentTimeMillis, engine.state, (now, state) =>
          resolveQueueSummary(state, now, new URL(request.originalUrl).origin)
        )
      );
  })
);
