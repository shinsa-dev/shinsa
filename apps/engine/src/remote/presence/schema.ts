import type { RemoteTeam, TeamPresence } from '@shinsa/core';
import type { Effect, Scope } from 'effect';

export interface OwnerPresence {
  readonly active: boolean;
  readonly seenAt: number | null;
}

export type TeamPeople = Pick<RemoteTeam, 'owner' | 'members'>;

export interface PresenceHandle {
  recordOwner(owner: OwnerPresence): Effect.Effect<void>;
  openViewer(userId: string): Effect.Effect<void>;
  closeViewer(userId: string): Effect.Effect<void>;
  listTeam(team: TeamPeople, ownerId: string | null): Effect.Effect<TeamPresence[]>;
  observe(listener: Effect.Effect<void>): Effect.Effect<void, never, Scope.Scope>;
}
