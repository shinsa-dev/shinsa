import {
  MAX_OWNED_TEAMS,
  MAX_TEAM_MEMBERS,
  type RemoteMember,
  type RemoteUserId,
  type TeamId,
} from '@shinsa/core';
import { CurrentMachine, RemoteApi } from '@shinsa/core/remote/api';
import { MembersFull, NotFound, Revoked, TeamsFull } from '@shinsa/core/remote/errors';
import { Clock, Effect, Option } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { findOwnTeam } from '../../auth/access.ts';
import { asCurrentUser } from '../../auth/tokens.ts';
import { CloudCrypto } from '../../crypto/service.ts';
import { connectTeam, joinTeam, leaveTeam, replaceInvite, serializeTeam } from '../../domain/teams.ts';
import { Accounts } from '../../store/accounts/service.ts';
import { Teams } from '../../store/teams/service.ts';
export const MachineTeamsHandlers = HttpApiBuilder.group(
  RemoteApi,
  'machineTeams',
  Effect.fn(function* (handlers) {
    const ok = { ok: true as const };
    const MachineOwner = Effect.gen(function* () {
      const accounts = yield* Accounts;
      const { ownerId } = yield* CurrentMachine;
      const owner = yield* accounts.selectUser(ownerId);
      if (Option.isNone(owner)) return yield* new Revoked({ message: 'This machine is not paired.' });
      return asCurrentUser(owner.value);
    });

    const OwnTeam = (teamId: TeamId) =>
      Effect.flatMap(MachineOwner, (owner) => findOwnTeam(owner.id, teamId));

    const teams = yield* Teams;
    const accounts = yield* Accounts;

    const addMember = Effect.fn('machineTeams.addMember')(function* (teamId: TeamId, userId: RemoteUserId) {
      const team = yield* OwnTeam(teamId);
      const inTeam = team.userId === userId || (yield* teams.members.has(team.id, userId));
      const asked = yield* teams.requesters.has(team.id, userId);
      const added = yield* accounts.selectUser(userId);
      if (Option.isNone(added) || !(inTeam || asked))
        return yield* new NotFound({ message: 'No one with that account asked to join this team.' });
      const now = yield* Clock.currentTimeMillis;
      if (!inTeam) {
        if ((yield* teams.members.count(team.id)) >= MAX_TEAM_MEMBERS)
          return yield* new MembersFull({
            message: `This team already has ${MAX_TEAM_MEMBERS} members. Remove one first.`,
          });
        yield* teams.members.add(team.id, userId);
      }
      yield* teams.requesters.remove(team.id, userId);
      return { user: added.value, addedAt: now } satisfies RemoteMember;
    });

    return handlers
      .handle(
        'create',
        Effect.fn('machineTeams.create')(function* ({ payload }) {
          const crypto = yield* CloudCrypto;
          const owner = yield* MachineOwner;
          if ((yield* teams.countOwned(owner.id)) >= MAX_OWNED_TEAMS)
            return yield* new TeamsFull({
              message: `You already own ${MAX_OWNED_TEAMS} teams. Remove one first.`,
            });
          const team = yield* teams.create({
            id: yield* crypto.createTeamId,
            userId: owner.id,
            name: payload.name,
          });
          const invite = yield* replaceInvite(team.id);
          return { team: yield* serializeTeam(team, owner.id), invite };
        })
      )
      .handle('join', ({ payload }) =>
        Effect.flatMap(MachineOwner, (owner) => joinTeam(owner.id, payload.invite))
      )
      .handle(
        'invite',
        Effect.fn('machineTeams.invite')(function* ({ params }) {
          const team = yield* OwnTeam(params.teamId);
          return { invite: yield* replaceInvite(team.id) };
        })
      )
      .handle(
        'inviteRemove',
        Effect.fn('machineTeams.inviteRemove')(function* ({ params }) {
          yield* teams.invites.remove((yield* OwnTeam(params.teamId)).id);
          return ok;
        })
      )
      .handle('memberAdd', ({ params, payload }) => addMember(params.teamId, payload.userId))
      .handle(
        'memberRemove',
        Effect.fn('machineTeams.memberRemove')(function* ({ params, payload }) {
          yield* teams.members.remove((yield* OwnTeam(params.teamId)).id, payload.userId);
          return ok;
        })
      )
      .handle(
        'requestDecline',
        Effect.fn('machineTeams.requestDecline')(function* ({ params, payload }) {
          yield* teams.requesters.remove((yield* OwnTeam(params.teamId)).id, payload.userId);
          return ok;
        })
      )
      .handle('leave', ({ params }) =>
        Effect.flatMap(MachineOwner, (owner) => leaveTeam(owner.id, params.teamId))
      )
      .handle(
        'remove',
        Effect.fn('machineTeams.remove')(function* ({ params }) {
          yield* teams.remove((yield* OwnTeam(params.teamId)).id);
          return ok;
        })
      )
      .handle('connect', ({ params, payload }) =>
        Effect.flatMap(MachineOwner, (owner) => connectTeam(owner.id, params.teamId, payload.instanceId))
      );
  })
);
