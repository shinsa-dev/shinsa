import type { RemoteRole, RemoteTeam, RemoteUserId, TeamMachine } from '@shinsa/core';
import { NotFound } from '@shinsa/core/remote/errors';
import { Clock, Effect, Option } from 'effect';
import { Accounts } from '../store/accounts.ts';
import type { Team } from '../store/teams.ts';
import { Teams } from '../store/teams.ts';
import { isMachineOnline } from './machines.ts';

export const findTeamOwner = Effect.fn('findTeamOwner')(function* (team: Team) {
  const accounts = yield* Accounts;
  const owner = yield* accounts.selectUser(team.userId);
  if (Option.isNone(owner)) return yield* new NotFound({ message: 'No such team.' });
  return owner.value;
});

export const serializeTeam = Effect.fn('serializeTeam')(function* (team: Team, userId: RemoteUserId) {
  const teams = yield* Teams;
  const now = yield* Clock.currentTimeMillis;
  const role: RemoteRole = team.userId === userId ? 'owner' : 'member';
  const machines = (yield* teams.listMachines(team.id)).map(
    (machine): TeamMachine => ({
      id: machine.id,
      name: machine.name,
      userId: machine.userId,
      online: isMachineOnline(machine, now),
      lastSeenAt: machine.lastSeenAt,
      ...(machine.signingKey ? { signingKey: machine.signingKey } : {}),
    })
  );
  return {
    id: team.id,
    name: team.name,
    owner: yield* findTeamOwner(team),
    role,
    members: yield* teams.members.list(team.id),
    requests: role === 'owner' ? yield* teams.requesters.list(team.id) : [],
    machines,
    createdAt: team.createdAt,
  } satisfies RemoteTeam;
});

export const listUserTeams = Effect.fn('listUserTeams')(function* (userId: RemoteUserId) {
  const teams = yield* Teams;
  return yield* Effect.forEach(yield* teams.listOfUser(userId), (team) => serializeTeam(team, userId));
});
