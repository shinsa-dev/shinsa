import { EngineApi } from '@shinsa/core/engine-api';
import { RequestFailed, RouteNotFound, ROUTE_NOT_FOUND_MESSAGE } from '@shinsa/core/engine-api/schema';
import { Effect } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { requestPromise } from '../../failures.ts';
import { HttpServices } from '../../services/service.ts';
import { DEVICE_NOT_FOUND } from './schema.ts';

export const RemoteHandlers = HttpApiBuilder.group(
  EngineApi,
  'remote',
  Effect.fn('RemoteHandlers')(function* (handlers) {
    const { remote: given } = yield* HttpServices;
    const remote = given
      ? Effect.succeed(given)
      : Effect.fail(new RouteNotFound({ message: ROUTE_NOT_FOUND_MESSAGE }));
    const act = Effect.fn('RemoteHandlers.act')(function* (
      run: (found: NonNullable<typeof given>) => unknown
    ) {
      const found = yield* remote;
      yield* requestPromise(() => Promise.resolve(run(found)));
      return found.snapshot();
    });

    return handlers
      .handle('snapshot', () => Effect.map(remote, (found) => found.snapshot()))
      .handle('pair', () => act((found) => found.startPairing()))
      .handle('cancelPairing', () => act((found) => found.cancelPairing()))
      .handle('enable', () => act((found) => found.enable()))
      .handle('disable', () => act((found) => found.disable()))
      .handle('remove', () => act((found) => found.remove()))
      .handle('createLink', () => act((found) => found.createLink()))
      .handle('removeLink', () => act((found) => found.removeLink()))
      .handle('acceptRequest', ({ payload }) => act((found) => found.acceptRequest(payload.requestId)))
      .handle('declineRequest', ({ payload }) => act((found) => found.declineRequest(payload.requestId)))
      .handle('grantMember', ({ payload }) =>
        act((found) => found.grantTeammate(payload.userId, payload.teamId))
      )
      .handle('removeMember', ({ payload }) => act((found) => found.removeMember(payload.userId)))
      .handle('removeDevice', ({ payload }) =>
        Effect.flatMap(remote, (found) =>
          found.removeDevice(payload.publicKey)
            ? Effect.sync(() => found.snapshot())
            : Effect.fail(new RequestFailed(DEVICE_NOT_FOUND))
        )
      );
  })
);
