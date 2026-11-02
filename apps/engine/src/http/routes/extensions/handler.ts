import { EngineApi } from '@shinsa/core/engine-api';
import { RouteNotFound, ROUTE_NOT_FOUND_MESSAGE } from '@shinsa/core/engine-api/schema';
import { Effect } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { requestPromise } from '../../failures.ts';
import { HttpServices } from '../../services/service.ts';

export const ExtensionsHandlers = HttpApiBuilder.group(
  EngineApi,
  'extensions',
  Effect.fn('ExtensionsHandlers')(function* (handlers) {
    const { extensions: given } = yield* HttpServices;
    const extensions = given
      ? Effect.succeed(given)
      : Effect.fail(new RouteNotFound({ message: ROUTE_NOT_FOUND_MESSAGE }));
    const act = <A>(run: (found: NonNullable<typeof given>) => A | PromiseLike<A>) =>
      Effect.flatMap(extensions, (found) => requestPromise(() => Promise.resolve(run(found))));

    return handlers
      .handle('snapshot', () => act((found) => found.readSnapshot()))
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
