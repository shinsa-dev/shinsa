import type { AttentionPlace, ScopedActor, RequestOrigin } from '@shinsa/core';
import { Duration, type Effect } from 'effect';

export const ATTENTION_IDLE = Duration.minutes(5);

export interface AttentionMember {
  readonly data: { readonly origin: RequestOrigin; readonly guest: ScopedActor | null };
}

export type AttentionTell<Member> = (member: Member, where: AttentionPlace) => void;

export interface OwnerActivity {
  readonly active: boolean;
  readonly seenAt: number | null;
}

export type OwnerActivityListener = (owner: OwnerActivity) => Effect.Effect<void>;

export interface AttentionTracker<Member> {
  report(member: Member, active: boolean): Effect.Effect<void>;
  remove(member: Member): Effect.Effect<void>;
}
