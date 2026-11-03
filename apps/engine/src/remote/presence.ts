import type { RemoteTeam, TeamPresence } from '@shinsa/core';

export interface OwnerPresence {
  active: boolean;
  seenAt: number | null;
}

type TeamPeople = Pick<RemoteTeam, 'owner' | 'members'>;

export class Presence {
  readonly #now: () => number;
  readonly #listeners = new Set<() => void>();
  readonly #viewing = new Map<string, number>();
  readonly #seenAt = new Map<string, number>();
  #owner: OwnerPresence = { active: false, seenAt: null };

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  subscribe(listener: () => void) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #publish() {
    for (const listener of this.#listeners) listener();
  }

  recordOwner(owner: OwnerPresence) {
    if (owner.active === this.#owner.active && owner.seenAt === this.#owner.seenAt) return;
    this.#owner = owner;
    this.#publish();
  }

  openViewer(userId: string) {
    const count = this.#viewing.get(userId) ?? 0;
    this.#viewing.set(userId, count + 1);
    this.#seenAt.set(userId, this.#now());
    if (count === 0) this.#publish();
  }

  closeViewer(userId: string) {
    const count = this.#viewing.get(userId) ?? 0;
    if (count === 0) return;
    this.#seenAt.set(userId, this.#now());
    if (count > 1) {
      this.#viewing.set(userId, count - 1);
      return;
    }
    this.#viewing.delete(userId);
    this.#publish();
  }

  listTeam(team: TeamPeople, ownerId: string | null): TeamPresence[] {
    const people = [team.owner.id, ...team.members.map((member) => member.user.id)];
    return people.flatMap((userId): TeamPresence[] => {
      if (userId === ownerId)
        return [{ userId, status: this.#owner.active ? 'online' : 'away', seenAt: this.#owner.seenAt }];
      if (this.#viewing.has(userId)) return [{ userId, status: 'online', seenAt: this.#now() }];
      const seenAt = this.#seenAt.get(userId);
      return seenAt === undefined ? [] : [{ userId, status: 'offline', seenAt }];
    });
  }
}
