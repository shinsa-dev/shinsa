import { resolveSharedTeams } from '@shinsa/core';
import { EngineApi } from '@shinsa/core/engine-api';
import { RequestFailed, RouteNotFound, ROUTE_NOT_FOUND_MESSAGE } from '@shinsa/core/engine-api/schema';
import { Effect, Option } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { Remote } from '../../../remote/machine/service.ts';
import { EngineCore } from '../../../runtime/engine/service.ts';
import { resolveRequestFailure } from '../../failures.ts';
import { DEVICE_NOT_FOUND } from './schema.ts';

export const RemoteHandlers = HttpApiBuilder.group(
  EngineApi,
  'remote',
  Effect.fn('RemoteHandlers')(function* (handlers) {
    const given = Option.getOrUndefined(yield* Effect.serviceOption(Remote));
    const engine = yield* EngineCore;
    const remote = given
      ? Effect.succeed(given)
      : Effect.fail(new RouteNotFound({ message: ROUTE_NOT_FOUND_MESSAGE }));
    type Found = NonNullable<typeof given>;
    const act = Effect.fn('RemoteHandlers.act')(function* <E>(
      run: (found: Found) => Effect.Effect<unknown, E>
    ) {
      const found = yield* remote;
      yield* run(found).pipe(Effect.mapError(resolveRequestFailure));
      return yield* found.snapshot;
    });

    return handlers
      .handle('snapshot', () => Effect.flatMap(remote, (found) => found.snapshot))
      .handle('pair', () => act((found) => found.startPairing))
      .handle('cancelPairing', () => act((found) => found.cancelPairing))
      .handle('enable', () => act((found) => found.enable))
      .handle('disable', () => act((found) => found.disable))
      .handle('remove', () => act((found) => found.remove))
      .handle('createLink', () => act((found) => found.createLink))
      .handle('removeLink', () => act((found) => found.removeLink))
      .handle('acceptRequest', ({ payload }) => act((found) => found.acceptRequest(payload.requestId)))
      .handle('declineRequest', ({ payload }) => act((found) => found.declineRequest(payload.requestId)))
      .handle('grantMember', ({ payload }) =>
        act((found) => found.grantTeammate(payload.userId, payload.teamId))
      )
      .handle('shareMachine', ({ payload }) =>
        act(
          Effect.fn('RemoteHandlers.shareMachine')(function* (found) {
            const settings = (yield* engine.state).settings;
            const sharedTeams = resolveSharedTeams(settings, payload.teamId, payload.shared);
            if (payload.shared) yield* found.shareWithTeam(payload.teamId);
            yield* engine.dispatch({ type: 'settings.change', patch: { sharedTeams } });
            if (!payload.shared) yield* found.unshareTeam(payload.teamId);
          })
        )
      )
      .handle('removeMember', ({ payload }) => act((found) => found.removeMember(payload.userId)))
      .handle(
        'removeDevice',
        Effect.fn('RemoteHandlers.removeDevice')(function* ({ payload }) {
          const found = yield* remote;
          if (!(yield* found.removeDevice(payload.publicKey)))
            return yield* new RequestFailed(DEVICE_NOT_FOUND);
          return yield* found.snapshot;
        })
      );
  })
);
