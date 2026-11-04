import type { AttentionPlace } from '@shinsa/core';
import { Clock, Duration, Effect, Fiber } from 'effect';
import {
  ATTENTION_IDLE,
  type AttentionMember,
  type AttentionTell,
  type AttentionTracker,
  type OwnerActivityListener,
} from './schema.ts';

export const makeAttentionTracker = Effect.fn('AttentionTracker.make')(function* <
  Member extends AttentionMember,
>(tell: AttentionTell<Member>, onOwner: OwnerActivityListener | null = null) {
  const scope = yield* Effect.scope;
  const idleMs = Duration.toMillis(ATTENTION_IDLE);
  const activeAt = new Map<Member, number>();
  const told = new Map<Member, AttentionPlace | null>();
  let expiry: Fiber.Fiber<void> | null = null;
  let seenAt: number | null = null;

  const isOwnersOwn = (member: Member) => !member.data.guest && member.data.origin !== 'remote';

  const selectHolder = (now: number) => {
    let holder: Member | null = null;
    let latest = 0;
    for (const [member, at] of activeAt) {
      if (now - at >= idleMs || (holder && at <= latest)) continue;
      holder = member;
      latest = at;
    }
    return { holder, expiresAt: latest + idleMs };
  };

  const resolvePlace = (member: Member, holder: Member | null): AttentionPlace => {
    if (!isOwnersOwn(member) || !holder) return 'nowhere';
    return holder === member ? 'here' : 'elsewhere';
  };

  const cancelExpiry = Effect.suspend(() => {
    const fiber = expiry;
    expiry = null;
    return fiber ? Fiber.interrupt(fiber) : Effect.void;
  });

  const sync: () => Effect.Effect<void> = Effect.fn('AttentionTracker.sync')(function* () {
    const now = yield* Clock.currentTimeMillis;
    const { holder, expiresAt } = selectHolder(now);
    for (const [member, place] of told) {
      const where = resolvePlace(member, holder);
      if (where === place) continue;
      told.set(member, where);
      tell(member, where);
    }
    yield* cancelExpiry;
    if (onOwner) yield* onOwner({ active: holder !== null, seenAt });
    if (!holder) return;
    const expire = Effect.sleep(Duration.millis(expiresAt - now)).pipe(
      Effect.andThen(
        Effect.sync(() => {
          expiry = null;
        })
      ),
      Effect.andThen(Effect.suspend(sync))
    );
    expiry = yield* Effect.forkIn(expire, scope);
  });

  const report = Effect.fn('AttentionTracker.report')(function* (member: Member, active: boolean) {
    if (member.data.guest) return;
    if (!told.has(member)) told.set(member, null);
    if (active && isOwnersOwn(member)) {
      seenAt = yield* Clock.currentTimeMillis;
      activeAt.set(member, seenAt);
    }
    yield* sync();
  });

  const remove = Effect.fn('AttentionTracker.remove')(function* (member: Member) {
    told.delete(member);
    if (activeAt.delete(member)) yield* sync();
  });

  const tracker: AttentionTracker<Member> = { report, remove };
  return tracker;
});
