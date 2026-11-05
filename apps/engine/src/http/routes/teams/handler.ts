import { EngineApi } from '@shinsa/core/engine-api';
import { RouteNotFound, ROUTE_NOT_FOUND_MESSAGE } from '@shinsa/core/engine-api/schema';
import { Effect, Option } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { Remote } from '../../../remote/machine/service.ts';
import { TeamFeeds } from '../../../remote/team-feeds/service.ts';
import { Teams } from '../../../remote/teams/service.ts';
import { resolveRequestFailure } from '../../failures.ts';

export const TeamsHandlers = HttpApiBuilder.group(
  EngineApi,
  'teams',
  Effect.fn('TeamsHandlers')(function* (handlers) {
    const remote = Option.getOrUndefined(yield* Effect.serviceOption(Remote));
    const given = Option.getOrUndefined(yield* Effect.serviceOption(Teams));
    const teamFeeds = Option.getOrUndefined(yield* Effect.serviceOption(TeamFeeds));
    const notFound = Effect.fail(new RouteNotFound({ message: ROUTE_NOT_FOUND_MESSAGE }));
    const services = remote && given ? Effect.succeed({ remote, teams: given }) : notFound;
    const teams = Effect.map(services, (found) => found.teams);
    type Found = NonNullable<typeof given>;
    const request = <A, E>(effect: Effect.Effect<A, E>) =>
      effect.pipe(Effect.mapError(resolveRequestFailure));

    const resolveLink = Effect.fn('TeamsHandlers.resolveLink')(function* (found: Found, teamId: string) {
      return { url: yield* request(found.resolveJoinUrl(teamId)) };
    });

    const change = Effect.fn('TeamsHandlers.change')(function* <E>(
      run: (found: Found) => Effect.Effect<void, E>
    ) {
      const found = yield* services;
      yield* request(run(found.teams));
      return yield* found.remote.snapshot;
    });

    return handlers
      .handle(
        'create',
        Effect.fn('TeamsHandlers.create')(function* ({ payload }) {
          const found = yield* teams;
          const teamId = yield* request(found.create(payload.name));
          return { teamId, ...(yield* resolveLink(found, teamId)) };
        })
      )
      .handle('join', ({ payload }) => Effect.flatMap(teams, (found) => request(found.join(payload.url))))
      .handle('link', ({ payload }) => Effect.flatMap(teams, (found) => resolveLink(found, payload.teamId)))
      .handle(
        'renewLink',
        Effect.fn('TeamsHandlers.renewLink')(function* ({ payload }) {
          const found = yield* teams;
          yield* request(found.renewInvite(payload.teamId));
          return yield* resolveLink(found, payload.teamId);
        })
      )
      .handle('removeLink', ({ payload }) => change((found) => found.turnOffInvite(payload.teamId)))
      .handle('acceptRequest', ({ payload }) =>
        change((found) => found.acceptRequest(payload.teamId, payload.userId))
      )
      .handle('declineRequest', ({ payload }) =>
        change((found) => found.declineRequest(payload.teamId, payload.userId))
      )
      .handle('removeMember', ({ payload }) =>
        change((found) => found.removeMember(payload.teamId, payload.userId))
      )
      .handle('scopes', ({ payload }) =>
        change((found) => found.updateScopes(payload.teamId, payload.userId ?? null, payload.scopes))
      )
      .handle('extra', ({ payload }) =>
        change((found) => found.updateExtra(payload.teamId, payload.userId, payload.scopes))
      )
      .handle('keys', () =>
        Effect.flatMap(teams, (found) => Effect.map(found.listKeys, (keys) => ({ keys })))
      )
      .handle('requestKey', ({ payload }) => change((found) => found.requestKey(payload.teamId)))
      .handle('answerKey', ({ payload }) =>
        teamFeeds
          ? change(() =>
              Effect.asVoid(teamFeeds.answerKeyRequest(payload.teamId, payload.instanceId, payload.approve))
            )
          : notFound
      )
      .handle('leave', ({ payload }) => change((found) => found.leave(payload.teamId)))
      .handle('remove', ({ payload }) => change((found) => found.remove(payload.teamId)))
      .handle('tasks', ({ query }) =>
        teamFeeds
          ? Effect.gen(function* () {
              return {
                machines: (yield* teamFeeds.snapshot).machines,
                tasks: yield* teamFeeds.listTasks({
                  teamId: query.team ?? null,
                  open: query.open === 'true',
                }),
              };
            })
          : notFound
      );
  })
);
