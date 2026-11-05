import {
  type InstanceId,
  type RemoteRole,
  type RemoteTeam,
  type RemoteUserId,
  DEFAULT_TEAM_SCOPES,
  type TeamId,
  type TeamJoinStatus,
  type TeamScopesRequest,
} from '@shinsa/core';
import { InviteInvalid, NoMachine, NotFound, OwnerCannotLeave } from '@shinsa/core/remote/errors';
import { Clock, Effect, Option, Redacted } from 'effect';
import { findTeamAccess, isTeamOwner, selectTeamRole } from '../auth/access.ts';
import { NO_SUCH_TEAM } from '../auth/schema.ts';
import { CloudCrypto } from '../crypto/service.ts';
import { Machines } from '../store/machines/service.ts';
import type { Team } from '../store/teams/schema.ts';
import { Teams } from '../store/teams/service.ts';
import { createConnectAnswer, findOwner, serializeTeamMachine } from './machines.ts';

export const serializeTeam = Effect.fn('serializeTeam')(function* (team: Team, userId: RemoteUserId) {
  const teams = yield* Teams;
  const now = yield* Clock.currentTimeMillis;
  const role: RemoteRole = isTeamOwner(team, userId) ? 'owner' : 'member';
  const machines = (yield* teams.listMachines(team.id)).map((machine) => serializeTeamMachine(machine, now));
  return {
    id: team.id,
    name: team.name,
    owner: yield* findOwner(team.ownerId, NO_SUCH_TEAM),
    role,
    members: yield* teams.members.list(team.id),
    requests: role === 'owner' ? yield* teams.requesters.list(team.id) : [],
    machines,
    scopes: team.scopes ?? DEFAULT_TEAM_SCOPES,
    overrides: yield* teams.listMemberScopes(team.id),
    createdAt: team.createdAt,
  } satisfies RemoteTeam;
});

export const updateTeamScopes = Effect.fn('teams.updateScopes')(function* (
  team: Team,
  request: TeamScopesRequest
) {
  const teams = yield* Teams;
  const userId = request.userId;
  if (userId === undefined) {
    yield* teams.replaceScopes(team.id, request.scopes);
    return { ...team, scopes: request.scopes };
  }
  if (!(yield* teams.members.has(team.id, userId)))
    return yield* new NotFound({ message: 'That person is not a member of this team.' });
  yield* teams.replaceMemberScopes(team.id, userId, request.scopes);
  return team;
});

export const listUserTeams = Effect.fn('listUserTeams')(function* (userId: RemoteUserId) {
  const teams = yield* Teams;
  return yield* Effect.forEach(yield* teams.listOfUser(userId), (team) => serializeTeam(team, userId));
});

export const replaceInvite = Effect.fn('teams.replaceInvite')(function* (teamId: TeamId) {
  const crypto = yield* CloudCrypto;
  const teams = yield* Teams;
  const invite = yield* crypto.createToken();
  yield* teams.invites.replace(teamId, yield* crypto.hashToken(invite));
  return Redacted.value(invite);
});

export const findInviteTeam = Effect.fn('teams.findInviteTeam')(function* (invite: string) {
  const crypto = yield* CloudCrypto;
  const teams = yield* Teams;
  const teamId = yield* teams.invites.select(yield* crypto.hashToken(Redacted.make(invite)));
  const team = Option.isSome(teamId) ? yield* teams.select(teamId.value) : Option.none();
  if (Option.isNone(team))
    return yield* new InviteInvalid({
      message: 'This team link was turned off. Ask the team’s owner for a new one.',
    });
  return { team: team.value, owner: yield* findOwner(team.value.ownerId, NO_SUCH_TEAM) };
});

export const joinTeam = Effect.fn('teams.join')(function* (userId: RemoteUserId, invite: string) {
  const teams = yield* Teams;
  const { team, owner } = yield* findInviteTeam(invite);
  const member = Option.isSome(yield* selectTeamRole(team, userId));
  if (!member) yield* teams.requesters.add(team.id, userId);
  const status: TeamJoinStatus = member ? 'member' : 'requested';
  return { teamId: team.id, name: team.name, owner, status };
});

export const TEAM_NO_MACHINE =
  'Turn on remote access on one of your machines first. Your teammates reach your work through it.';

export const assertPairedMachine = Effect.fn('teams.assertPairedMachine')(function* (userId: RemoteUserId) {
  if ((yield* (yield* Machines).countOwned(userId)) > 0) return;
  return yield* new NoMachine({ message: TEAM_NO_MACHINE });
});

export const leaveTeam = Effect.fn('teams.leave')(function* (userId: RemoteUserId, teamId: TeamId) {
  const teams = yield* Teams;
  const { team, role } = yield* findTeamAccess(userId, teamId);
  if (role === 'owner')
    return yield* new OwnerCannotLeave({ message: 'You own this team. Remove it instead.' });
  yield* teams.members.remove(team.id, userId);
  return { ok: true as const };
});

export const connectTeam = Effect.fn('teams.connect')(function* (
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
