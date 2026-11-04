import { EngineApi } from '@shinsa/core/engine-api';
import { RouteNotFound, ROUTE_NOT_FOUND_MESSAGE } from '@shinsa/core/engine-api/schema';
import { Effect, Option } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { Extensions } from '../../../extensions/registry/service.ts';
import { resolveRequestFailure } from '../../failures.ts';

export const ExtensionsHandlers = HttpApiBuilder.group(
  EngineApi,
  'extensions',
  Effect.fn('ExtensionsHandlers')(function* (handlers) {
    const given = Option.getOrUndefined(yield* Effect.serviceOption(Extensions));
    const extensions = given
      ? Effect.succeed(given)
      : Effect.fail(new RouteNotFound({ message: ROUTE_NOT_FOUND_MESSAGE }));
    const act = <A, E>(run: (found: NonNullable<typeof given>) => Effect.Effect<A, E>) =>
      Effect.flatMap(extensions, (found) => Effect.mapError(run(found), resolveRequestFailure));

    return handlers
      .handle('snapshot', () => act((found) => found.readSnapshot))
      .handle('check', ({ payload }) => act((found) => found.check(payload.serverId)))
      .handle('addServer', ({ payload }) => act((found) => found.createServer(payload.server)))
      .handle('updateServer', ({ payload }) =>
        act((found) => found.updateServer(payload.serverId, payload.server))
      )
      .handle('removeServer', ({ payload }) => act((found) => found.removeServer(payload.serverId)))
      .handle('chooseServer', ({ payload }) =>
        act((found) => found.updateServerChoice(payload.serverId, payload))
      )
      .handle('signIn', ({ payload }) => act((found) => found.startSignIn(payload.serverId)))
      .handle('signOut', ({ payload }) => act((found) => found.signOut(payload.serverId)))
      .handle('chooseSkill', ({ payload }) =>
        act((found) => found.updateSkillChoice(payload.skillId, payload.enabled))
      )
      .handle('choosePlugin', ({ payload }) =>
        act((found) => found.updatePluginChoice(payload.pluginId, payload.enabled))
      )
      .handle('optimizer', ({ payload }) => act((found) => found.updateOptimizer(payload)));
  })
);
