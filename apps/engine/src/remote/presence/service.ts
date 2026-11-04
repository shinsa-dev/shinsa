import type { TeamPresence } from '@shinsa/core';
import { Clock, Context, Effect, Layer } from 'effect';
import type { OwnerPresence, PresenceHandle, TeamPeople } from './schema.ts';

export class Presence extends Context.Service<Presence, PresenceHandle>()(
  'shinsa/engine/remote/presence/Presence'
) {
  static readonly layer = Layer.sync(Presence, () => {
    const listeners = new Set<Effect.Effect<void>>();
    const viewing = new Map<string, number>();
    const seenAt = new Map<string, number>();
    let owner: OwnerPresence = { active: false, seenAt: null };

    const publish = Effect.suspend(() =>
      Effect.forEach([...listeners], (listener) => listener, { discard: true })
    );

    const observe = (listener: Effect.Effect<void>) =>
      Effect.acquireRelease(
        Effect.sync(() => listeners.add(listener)),
        () => Effect.sync(() => listeners.delete(listener))
      ).pipe(Effect.asVoid);

    const recordOwner = Effect.fn('Presence.recordOwner')(function* (next: OwnerPresence) {
      if (next.active === owner.active && next.seenAt === owner.seenAt) return;
      owner = next;
      yield* publish;
    });

    const openViewer = Effect.fn('Presence.openViewer')(function* (userId: string) {
      const count = viewing.get(userId) ?? 0;
      viewing.set(userId, count + 1);
      seenAt.set(userId, yield* Clock.currentTimeMillis);
      if (count === 0) yield* publish;
    });

    const closeViewer = Effect.fn('Presence.closeViewer')(function* (userId: string) {
      const count = viewing.get(userId) ?? 0;
      if (count === 0) return;
      seenAt.set(userId, yield* Clock.currentTimeMillis);
      if (count > 1) {
        viewing.set(userId, count - 1);
        return;
      }
      viewing.delete(userId);
      yield* publish;
    });

    const listTeam = Effect.fn('Presence.listTeam')(function* (team: TeamPeople, ownerId: string | null) {
      const now = yield* Clock.currentTimeMillis;
      const people = [team.owner.id, ...team.members.map((member) => member.user.id)];
      return people.flatMap((userId): TeamPresence[] => {
        if (userId === ownerId)
          return [{ userId, status: owner.active ? 'online' : 'away', seenAt: owner.seenAt }];
        if (viewing.has(userId)) return [{ userId, status: 'online', seenAt: now }];
        const seen = seenAt.get(userId);
        return seen === undefined ? [] : [{ userId, status: 'offline', seenAt: seen }];
      });
    });

    return Presence.of({ recordOwner, openViewer, closeViewer, listTeam, observe });
  });
}
