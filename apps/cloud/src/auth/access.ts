import type { InstanceId, RemoteRole, RemoteUserId, TeamId } from '@shinsa/core';
import { NotFound, NotOwner } from '@shinsa/core/remote/errors';
import { Effect, Option } from 'effect';
import { MachineAccess } from '../store/access/service.ts';
import { Machines } from '../store/machines/service.ts';
import type { Team } from '../store/teams/schema.ts';
import { Teams } from '../store/teams/service.ts';
import {
  type MachineAccessGrant,
  NO_SUCH_MACHINE,
  NO_SUCH_TEAM,
  type TeamAccessGrant,
  type TeamRole,
} from './schema.ts';

export const selectMachineRole = Effect.fn('selectMachineRole')(function* (
  instanceId: InstanceId,
  ownerId: RemoteUserId,
  userId: RemoteUserId
) {
  const access = yield* MachineAccess;
  if (ownerId === userId) return Option.some<RemoteRole>('owner');
  if (yield* access.members.has(instanceId, userId)) return Option.some<RemoteRole>('member');
  if (yield* access.guests.has(instanceId, userId)) return Option.some<RemoteRole>('guest');
  return Option.none<RemoteRole>();
});

export const selectTeamRole = Effect.fn('selectTeamRole')(function* (team: Team, userId: RemoteUserId) {
  const teams = yield* Teams;
  if (team.userId === userId) return Option.some<TeamRole>('owner');
  if (yield* teams.members.has(team.id, userId)) return Option.some<TeamRole>('member');
  return Option.none<TeamRole>();
});

export const findMachineAccess = Effect.fn('findMachineAccess')(function* (
  userId: RemoteUserId,
  instanceId: InstanceId
) {
  const machines = yield* Machines;
  const machine = yield* machines.select(instanceId);
  const role = Option.isSome(machine)
    ? yield* selectMachineRole(machine.value.id, machine.value.userId, userId)
    : Option.none<RemoteRole>();
  if (Option.isNone(machine) || Option.isNone(role)) return yield* new NotFound({ message: NO_SUCH_MACHINE });
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
  const role = Option.isSome(team) ? yield* selectTeamRole(team.value, userId) : Option.none<TeamRole>();
  if (Option.isNone(team) || Option.isNone(role)) return yield* new NotFound({ message: NO_SUCH_TEAM });
  return { team: team.value, role: role.value } satisfies TeamAccessGrant;
});

export const findOwnTeam = Effect.fn('findOwnTeam')(function* (userId: RemoteUserId, teamId: TeamId) {
  const { team, role } = yield* findTeamAccess(userId, teamId);
  if (role !== 'owner') return yield* new NotOwner({ message: "Only the team's owner can do this." });
  return team;
});
