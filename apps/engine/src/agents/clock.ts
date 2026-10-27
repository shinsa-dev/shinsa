export const MINUTE_MS = 60_000;

export interface ClockTimers {
  now: () => number;
  start: (fire: () => void, ms: number) => unknown;
  clear: (timer: unknown) => void;
}

const SYSTEM_TIMERS: ClockTimers = {
  now: () => Date.now(),
  start: (fire, ms) => setTimeout(fire, ms),
  clear: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};

export class RunClock {
  #remaining: number;
  #startedAt = 0;
  #timer: unknown = null;
  #pauses = 0;
  #stopped = false;
  readonly #onExpire: () => void;
  readonly #timers: ClockTimers;

  constructor(limitMs: number, onExpire: () => void, timers: ClockTimers = SYSTEM_TIMERS) {
    this.#remaining = limitMs;
    this.#onExpire = onExpire;
    this.#timers = timers;
  }

  start() {
    this.#arm();
  }

  pause() {
    this.#pauses += 1;
    if (this.#pauses > 1 || this.#timer === null) return;
    this.#timers.clear(this.#timer);
    this.#timer = null;
    this.#remaining -= this.#timers.now() - this.#startedAt;
  }

  resume() {
    if (this.#pauses === 0) return;
    this.#pauses -= 1;
    if (this.#pauses === 0) this.#arm();
  }

  stop() {
    this.#stopped = true;
    if (this.#timer !== null) this.#timers.clear(this.#timer);
    this.#timer = null;
  }

  #arm() {
    if (this.#stopped) return;
    this.#startedAt = this.#timers.now();
    this.#timer = this.#timers.start(this.#onExpire, Math.max(0, this.#remaining));
  }
}
