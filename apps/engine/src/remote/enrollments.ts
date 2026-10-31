import { randomBytes } from 'node:crypto';
import { type HandshakeKeys, serializeBase64Url, verifyEnrollProof } from '@shinsa/core';

export const ENROLLMENT_TTL_MS = 10 * 60_000;

const SECRET_BYTES = 32;

const MAX_PENDING = 5;

interface PendingEnrollment {
  secret: string;
  name: string;
  expiresAt: number;
}

export class Enrollments {
  readonly #now: () => number;
  #pending: PendingEnrollment[] = [];

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  create(name: string) {
    const now = this.#now();
    const secret = serializeBase64Url(new Uint8Array(randomBytes(SECRET_BYTES)));
    const expiresAt = now + ENROLLMENT_TTL_MS;
    this.#pending = [...this.#listLive(now), { secret, name, expiresAt }].slice(-MAX_PENDING);
    return { secret, expiresAt };
  }

  clear() {
    this.#pending = [];
  }

  #listLive(now: number) {
    return this.#pending.filter((entry) => entry.expiresAt > now);
  }

  async redeem(proof: string, keys: Pick<HandshakeKeys, 'machine' | 'device' | 'clientEphemeral'>) {
    const live = this.#listLive(this.#now());
    for (const entry of live) {
      if (!(await verifyEnrollProof(entry.secret, proof, keys))) continue;
      this.#pending = this.#pending.filter((pending) => pending !== entry);
      return entry.name;
    }
    this.#pending = live;
    return null;
  }
}
