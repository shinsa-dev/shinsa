import {
  type InstanceId,
  MAX_OWNED_TEAMS,
  MAX_TEAM_MEMBERS,
  type RemoteMember,
  type RemoteUserId,
  type TeamId,
  type TeamJoinStatus,
} from '@shinsa/core';
import { CurrentMachine, CurrentUser, RemoteApi } from '@shinsa/core/remote/api';
import {
  InviteInvalid,
  MembersFull,
  NotFound,
  OwnerCannotLeave,
  Revoked,
  TeamsFull,
} from '@shinsa/core/remote/errors';
import { Clock, Effect, Option, Redacted } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { findOwnTeam, findTeamAccess } from '../auth/access.ts';
import { asCurrentUser } from '../auth/sessions.ts';
import { CloudCrypto } from '../crypto/crypto.ts';
import { Accounts } from '../store/accounts.ts';
import { Teams } from '../store/teams.ts';
import { createConnectAnswer } from '../views/machines.ts';
import { findTeamOwner, listUserTeams, serializeTeam } from '../views/teams.ts';

const ok = { ok: true as const };

const replaceInvite = Effect.fn('teams.replaceInvite')(function* (teamId: TeamId) {
  const crypto = yield* CloudCrypto;
  const teams = yield* Teams;
  const invite = yield* crypto.createToken();
  yield* teams.invites.replace(teamId, yield* crypto.hashToken(invite));
  return Redacted.value(invite);
});

const findInviteTeam = Effect.fn('teams.findInviteTeam')(function* (invite: string) {
  const crypto = yield* CloudCrypto;
  const teams = yield* Teams;
  const teamId = yield* teams.invites.select(yield* crypto.hashToken(Redacted.make(invite)));
  const team = Option.isSome(teamId) ? yield* teams.select(teamId.value) : Option.none();
  if (Option.isNone(team))
    return yield* new InviteInvalid({
      message: 'This team link was turned off. Ask the team’s owner for a new one.',
    });
  return { team: team.value, owner: yield* findTeamOwner(team.value) };
});

const joinTeam = Effect.fn('teams.join')(function* (userId: RemoteUserId, invite: string) {
  const teams = yield* Teams;
  const { team, owner } = yield* findInviteTeam(invite);
  const member = team.userId === userId || (yield* teams.members.has(team.id, userId));
  if (!member) yield* teams.requesters.add(team.id, userId);
  const status: TeamJoinStatus = member ? 'member' : 'requested';
  return { teamId: team.id, name: team.name, owner, status };
});

const leaveTeam = Effect.fn('teams.leave')(function* (userId: RemoteUserId, teamId: TeamId) {
  const teams = yield* Teams;
  const { team, role } = yield* findTeamAccess(userId, teamId);
  if (role === 'owner')
    return yield* new OwnerCannotLeave({ message: 'You own this team. Remove it instead.' });
  yield* teams.members.remove(team.id, userId);
  return ok;
});

const connectTeam = Effect.fn('teams.connect')(function* (
  userId: RemoteUserId,
  teamId: TeamId,
  instanceId: InstanceId
) {
  const teams = yield* Teams;
  const { team } = yield* findTeamAccess(userId, teamId);
  const machine = (yield* teams.listMachines(team.id)).find((candidate) => candidate.id === instanceId);
  if (!machine) return yield* new NotFound({ message: 'That machine is not in this team.' });
  return yield* createConnectAnswer(machine, userId, 'team');
});

export const TeamsHandlers = HttpApiBuilder.group(
  RemoteApi,
  'teams',
  Effect.fn(function* (handlers) {
    return handlers
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
      );
  })
);

const MachineOwner = Effect.gen(function* () {
  const accounts = yield* Accounts;
  const { ownerId } = yield* CurrentMachine;
  const owner = yield* accounts.selectUser(ownerId);
  if (Option.isNone(owner)) return yield* new Revoked({ message: 'This machine is not paired.' });
  return asCurrentUser(owner.value);
});

const OwnTeam = (teamId: TeamId) => Effect.flatMap(MachineOwner, (owner) => findOwnTeam(owner.id, teamId));

export const MachineTeamsHandlers = HttpApiBuilder.group(
  RemoteApi,
  'machineTeams',
  Effect.fn(function* (handlers) {
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
      .handle('create', ({ payload }) =>
        Effect.gen(function* () {
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
      .handle('invite', ({ params }) =>
        Effect.gen(function* () {
          const team = yield* OwnTeam(params.teamId);
          return { invite: yield* replaceInvite(team.id) };
        })
      )
      .handle('inviteRemove', ({ params }) =>
        Effect.gen(function* () {
          yield* teams.invites.remove((yield* OwnTeam(params.teamId)).id);
          return ok;
        })
      )
      .handle('memberAdd', ({ params, payload }) => addMember(params.teamId, payload.userId))
      .handle('memberRemove', ({ params, payload }) =>
        Effect.gen(function* () {
          yield* teams.members.remove((yield* OwnTeam(params.teamId)).id, payload.userId);
          return ok;
        })
      )
      .handle('requestDecline', ({ params, payload }) =>
        Effect.gen(function* () {
          yield* teams.requesters.remove((yield* OwnTeam(params.teamId)).id, payload.userId);
          return ok;
        })
      )
      .handle('leave', ({ params }) =>
        Effect.flatMap(MachineOwner, (owner) => leaveTeam(owner.id, params.teamId))
      )
      .handle('remove', ({ params }) =>
        Effect.gen(function* () {
          yield* teams.remove((yield* OwnTeam(params.teamId)).id);
          return ok;
        })
      )
      .handle('connect', ({ params, payload }) =>
        Effect.flatMap(MachineOwner, (owner) => connectTeam(owner.id, params.teamId, payload.instanceId))
      );
  })
);
