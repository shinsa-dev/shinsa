import type { AttentionPlace, GuestActor, RequestOrigin } from '@shinsa/core';
import { Duration, type Effect } from 'effect';

export const ATTENTION_IDLE = Duration.minutes(5);

export interface AttentionMember {
  readonly data: { readonly origin: RequestOrigin; readonly guest: GuestActor | null };
}

export type AttentionTell<Member> = (member: Member, where: AttentionPlace) => void;

export interface AttentionTracker<Member> {
  report(member: Member, active: boolean): Effect.Effect<void>;
  remove(member: Member): Effect.Effect<void>;
}
