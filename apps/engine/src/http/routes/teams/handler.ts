import { EngineApi } from '@shinsa/core/engine-api';
import { RouteNotFound, ROUTE_NOT_FOUND_MESSAGE } from '@shinsa/core/engine-api/schema';
import { Effect } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { requestPromise } from '../../failures.ts';
import { HttpServices } from '../../services/service.ts';

export const TeamsHandlers = HttpApiBuilder.group(
  EngineApi,
  'teams',
  Effect.fn('TeamsHandlers')(function* (handlers) {
    const { remote, teams: given, teamFeeds } = yield* HttpServices;
    const notFound = Effect.fail(new RouteNotFound({ message: ROUTE_NOT_FOUND_MESSAGE }));
    const services = remote && given ? Effect.succeed({ remote, teams: given }) : notFound;
    const teams = Effect.map(services, (found) => found.teams);
    type Found = NonNullable<typeof given>;

    const resolveLink = Effect.fn('TeamsHandlers.resolveLink')(function* (found: Found, teamId: string) {
      return { url: yield* requestPromise(() => found.resolveJoinUrl(teamId)) };
    });

    const change = Effect.fn('TeamsHandlers.change')(function* (run: (found: Found) => PromiseLike<void>) {
      const found = yield* services;
      yield* requestPromise(() => run(found.teams));
      return found.remote.snapshot();
    });

    return handlers
      .handle(
        'create',
        Effect.fn('TeamsHandlers.create')(function* ({ payload }) {
          const found = yield* teams;
          const teamId = yield* requestPromise(() => found.create(payload.name));
          return { teamId, ...(yield* resolveLink(found, teamId)) };
        })
      )
      .handle('join', ({ payload }) =>
        Effect.flatMap(teams, (found) => requestPromise(() => found.join(payload.url)))
      )
      .handle('link', ({ payload }) => Effect.flatMap(teams, (found) => resolveLink(found, payload.teamId)))
      .handle(
        'renewLink',
        Effect.fn('TeamsHandlers.renewLink')(function* ({ payload }) {
          const found = yield* teams;
          yield* requestPromise(() => found.renewInvite(payload.teamId));
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
      .handle('permissions', ({ payload }) =>
        change((found) =>
          found.updatePermissions(payload.teamId, payload.userId ?? null, payload.permissions)
        )
      )
      .handle('leave', ({ payload }) => change((found) => found.leave(payload.teamId)))
      .handle('remove', ({ payload }) => change((found) => found.remove(payload.teamId)))
      .handle('tasks', ({ query }) =>
        teamFeeds
          ? Effect.sync(() => ({
              machines: teamFeeds.snapshot().machines,
              tasks: teamFeeds.listTasks({ teamId: query.team ?? null, open: query.open === 'true' }),
            }))
          : notFound
      );
  })
);
