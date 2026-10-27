import { describeError, log } from '../log/index.ts';
import type { AgentSession } from './providers/index.ts';

export const IDLE_RELEASE_MS = 30 * 60 * 1000;

export const MAX_IDLE_PIN_MS = 4 * 60 * 60 * 1000;

export interface IdleReleaseOptions {
  idleMs?: number;
  maxPinMs?: number;
  now?: () => number;
}

type ReleaseHandler = (runId: string, session: AgentSession) => Promise<void>;

interface IdleEntry {
  session: AgentSession;
  waits: number;
  generation: number;
  timer: ReturnType<typeof setTimeout> | null;
  pinnedSince: number | null;
}

export class IdleRelease {
  readonly #entries = new Map<string, IdleEntry>();
  readonly #onRelease: ReleaseHandler;
  readonly #idleMs: number;
  readonly #maxPinMs: number;
  readonly #now: () => number;

  constructor(onRelease: ReleaseHandler, options: IdleReleaseOptions = {}) {
    this.#onRelease = onRelease;
    this.#idleMs = options.idleMs ?? IDLE_RELEASE_MS;
    this.#maxPinMs = options.maxPinMs ?? MAX_IDLE_PIN_MS;
    this.#now = options.now ?? Date.now;
  }

  wait(runId: string, session: AgentSession) {
    const entry = this.#entries.get(runId);
    if (entry?.session === session) {
      entry.waits += 1;
    } else {
      if (entry?.timer) clearTimeout(entry.timer);
      this.#entries.set(runId, { session, waits: 1, generation: 0, timer: null, pinnedSince: null });
    }
    this.#arm(runId, true);
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      this.#endWait(runId, session);
    };
  }

  isWaiting(runId: string, session: AgentSession) {
    return this.#entries.get(runId)?.session === session;
  }

  touch(runId: string) {
    const entry = this.#entries.get(runId);
    if (!entry || entry.waits === 0) return;
    this.#arm(runId, true);
  }

  forget(runId: string) {
    const entry = this.#entries.get(runId);
    if (entry?.timer) clearTimeout(entry.timer);
    this.#entries.delete(runId);
  }

  #endWait(runId: string, session: AgentSession) {
    const entry = this.#entries.get(runId);
    if (!entry || entry.session !== session) return;
    entry.waits -= 1;
    if (entry.waits > 0) return;
    this.forget(runId);
  }

  #arm(runId: string, activity: boolean) {
    const entry = this.#entries.get(runId);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    entry.generation += 1;
    if (activity) entry.pinnedSince = null;
    const generation = entry.generation;
    const session = entry.session;
    entry.timer = setTimeout(() => this.#releaseIfIdle(runId, generation, session), this.#idleMs);
    entry.timer.unref();
  }

  #releaseIfIdle(runId: string, generation: number, session: AgentSession) {
    const entry = this.#entries.get(runId);
    if (!entry || entry.generation !== generation || entry.session !== session || entry.waits === 0) return;
    entry.timer = null;
    if (session.hasPendingBackgroundWork?.() === true) {
      const now = this.#now();
      entry.pinnedSince ??= now;
      if (now - entry.pinnedSince < this.#maxPinMs) {
        this.#arm(runId, false);
        return;
      }
    }
    this.forget(runId);
    this.#onRelease(runId, session).catch((error: unknown) => {
      log.warn('[Runs] Could not release an idle session', { runId, error: describeError(error) });
    });
  }
}
