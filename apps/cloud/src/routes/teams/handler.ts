import { CurrentUser, RemoteApi } from '@shinsa/core/remote/api';
import { Effect } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { connectTeam, findInviteTeam, joinTeam, leaveTeam, listUserTeams } from '../../domain/teams.ts';

export const TeamsHandlers = HttpApiBuilder.group(RemoteApi, 'teams', (handlers) =>
  Effect.succeed(
    handlers
      .handle('list', () => Effect.flatMap(CurrentUser, (user) => listUserTeams(user.id)))
      .handle('join', ({ payload }) =>
        Effect.flatMap(CurrentUser, (user) => joinTeam(user.id, payload.invite))
      )
      .handle('preview', ({ payload }) =>
        Effect.map(findInviteTeam(payload.invite), ({ team, owner }) => ({ name: team.name, owner }))
      )
      .handle('leave', ({ params }) =>
        Effect.flatMap(CurrentUser, (user) => leaveTeam(user.id, params.teamId))
      )
      .handle('connect', ({ params, payload }) =>
        Effect.flatMap(CurrentUser, (user) => connectTeam(user.id, params.teamId, payload.instanceId))
      )
  )
);
