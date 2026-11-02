import type { RemoteRole } from '@shinsa/core';
import { Duration } from 'effect';
import type { Machine } from '../store/machines/schema.ts';
import type { Team } from '../store/teams/schema.ts';

export interface MachineAccessGrant {
  readonly machine: Machine;
  readonly role: RemoteRole;
}

export interface TeamAccessGrant {
  readonly team: Team;
  readonly role: Exclude<RemoteRole, 'guest'>;
}

export const BEARER = 'Bearer ';

export const SAFE_METHODS = new Set(['GET', 'HEAD']);

export const SESSION_TTL = Duration.days(30);

export const SIGN_IN_EXPIRED = 'The sign-in expired or came from somewhere else. Try again.';
