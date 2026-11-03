import type { RemoteRole } from '@shinsa/core';
import { Duration } from 'effect';
import type { Machine } from '../store/machines/schema.ts';
import type { Team } from '../store/teams/schema.ts';

export interface MachineAccessGrant {
  readonly machine: Machine;
  readonly role: RemoteRole;
}

export type TeamRole = Exclude<RemoteRole, 'guest'>;

export interface TeamAccessGrant {
  readonly team: Team;
  readonly role: TeamRole;
}

export const BEARER = 'Bearer ';

export const SAFE_METHODS = new Set(['GET', 'HEAD']);

export const SESSION_TTL = Duration.days(30);

export const NO_SUCH_MACHINE = 'No such machine.';

export const NO_SUCH_TEAM = 'No such team.';

export const NOT_PAIRED = 'This machine is not paired.';

export const OAUTH_STATE_BYTES = 24;

export const SIGN_IN_EXPIRED = 'The sign-in expired or came from somewhere else. Try again.';
