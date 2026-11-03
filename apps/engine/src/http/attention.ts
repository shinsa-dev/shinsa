import type { AttentionPlace, GuestActor, RequestOrigin } from '@shinsa/core';

export const ATTENTION_IDLE_MS = 5 * 60 * 1000;

export interface AttentionClock {
  now: () => number;
  schedule: (delayMs: number, run: () => void) => () => void;
}

interface AttentionMember {
  data: { origin: RequestOrigin; guest: GuestActor | null };
}

const SYSTEM_CLOCK: AttentionClock = {
  now: () => Date.now(),
  schedule: (delayMs, run) => {
    const timer = setTimeout(run, delayMs);
    timer.unref();
    return () => clearTimeout(timer);
  },
};

function isOwnersOwn(member: AttentionMember) {
  return !member.data.guest && member.data.origin !== 'remote';
}

export class AttentionTracker<Member extends AttentionMember> {
  readonly #tell: (member: Member, where: AttentionPlace) => void;
  readonly #clock: AttentionClock;
  readonly #activeAt = new Map<Member, number>();
  readonly #told = new Map<Member, AttentionPlace | null>();
  #cancelExpiry: (() => void) | null = null;

  constructor(tell: (member: Member, where: AttentionPlace) => void, clock = SYSTEM_CLOCK) {
    this.#tell = tell;
    this.#clock = clock;
  }

  report(member: Member, active: boolean) {
    if (member.data.guest) return;
    if (!this.#told.has(member)) this.#told.set(member, null);
    if (active && isOwnersOwn(member)) this.#activeAt.set(member, this.#clock.now());
    this.#sync();
  }

  remove(member: Member) {
    this.#told.delete(member);
    if (this.#activeAt.delete(member)) this.#sync();
  }

  stop() {
    this.#cancelExpiry?.();
    this.#cancelExpiry = null;
  }

  #selectHolder() {
    const now = this.#clock.now();
    let holder: Member | null = null;
    let latest = 0;
    for (const [member, at] of this.#activeAt) {
      if (!isOwnersOwn(member) || now - at >= ATTENTION_IDLE_MS || (holder && at <= latest)) continue;
      holder = member;
      latest = at;
    }
    return { holder, expiresAt: latest + ATTENTION_IDLE_MS };
  }

  #sync() {
    const { holder, expiresAt } = this.#selectHolder();
    for (const [member, told] of this.#told) {
      const where = resolvePlace(member, holder);
      if (where === told) continue;
      this.#told.set(member, where);
      this.#tell(member, where);
    }
    this.#cancelExpiry?.();
    this.#cancelExpiry = holder
      ? this.#clock.schedule(expiresAt - this.#clock.now(), () => this.#sync())
      : null;
  }
}

function resolvePlace(member: AttentionMember, holder: AttentionMember | null): AttentionPlace {
  if (!isOwnersOwn(member) || !holder) return 'nowhere';
  return holder === member ? 'here' : 'elsewhere';
}
