import type { InstanceId, RemoteRole, RemoteUserId, TeamId } from '@shinsa/core';
import { NotFound, NotOwner } from '@shinsa/core/remote/errors';
import { Effect, Option } from 'effect';
import { MachineAccess } from '../store/access.ts';
import type { Machine } from '../store/machines.ts';
import { Machines } from '../store/machines.ts';
import type { Team } from '../store/teams.ts';
import { Teams } from '../store/teams.ts';

interface MachineAccessGrant {
  readonly machine: Machine;
  readonly role: RemoteRole;
}

interface TeamAccessGrant {
  readonly team: Team;
  readonly role: Exclude<RemoteRole, 'guest'>;
}

const selectMachineRole = Effect.fn('selectMachineRole')(function* (machine: Machine, userId: RemoteUserId) {
  if (machine.userId === userId) return Option.some<RemoteRole>('owner');
  const access = yield* MachineAccess;
  if (yield* access.members.has(machine.id, userId)) return Option.some<RemoteRole>('member');
  if (yield* access.guests.has(machine.id, userId)) return Option.some<RemoteRole>('guest');
  return Option.none<RemoteRole>();
});

export const findMachineAccess = Effect.fn('findMachineAccess')(function* (
  userId: RemoteUserId,
  instanceId: InstanceId
) {
  const machines = yield* Machines;
  const machine = yield* machines.select(instanceId);
  const role = Option.isSome(machine) ? yield* selectMachineRole(machine.value, userId) : Option.none();
  if (Option.isNone(machine) || Option.isNone(role))
    return yield* new NotFound({ message: 'No such machine.' });
  return { machine: machine.value, role: role.value } satisfies MachineAccessGrant;
});

export const findOwnMachine = Effect.fn('findOwnMachine')(function* (
  userId: RemoteUserId,
  instanceId: InstanceId
) {
  const { machine, role } = yield* findMachineAccess(userId, instanceId);
  if (role !== 'owner') return yield* new NotOwner({ message: "Only the machine's owner can do this." });
  return machine;
});

export const findTeamAccess = Effect.fn('findTeamAccess')(function* (userId: RemoteUserId, teamId: TeamId) {
  const teams = yield* Teams;
  const team = yield* teams.select(teamId);
  if (Option.isSome(team) && team.value.userId === userId)
    return { team: team.value, role: 'owner' } satisfies TeamAccessGrant;
  if (Option.isSome(team) && (yield* teams.members.has(team.value.id, userId)))
    return { team: team.value, role: 'member' } satisfies TeamAccessGrant;
  return yield* new NotFound({ message: 'No such team.' });
});

export const findOwnTeam = Effect.fn('findOwnTeam')(function* (userId: RemoteUserId, teamId: TeamId) {
  const { team, role } = yield* findTeamAccess(userId, teamId);
  if (role !== 'owner') return yield* new NotOwner({ message: "Only the team's owner can do this." });
  return team;
});
