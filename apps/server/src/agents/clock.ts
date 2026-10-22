export class RunClock {
  #remaining: number;
  #startedAt = 0;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #pauses = 0;
  #stopped = false;
  readonly #onExpire: () => void;

  constructor(limitMs: number, onExpire: () => void) {
    this.#remaining = limitMs;
    this.#onExpire = onExpire;
  }

  start() {
    this.#arm();
  }

  pause() {
    this.#pauses += 1;
    if (this.#pauses > 1 || !this.#timer) return;
    clearTimeout(this.#timer);
    this.#timer = null;
    this.#remaining -= Date.now() - this.#startedAt;
  }

  resume() {
    if (this.#pauses === 0) return;
    this.#pauses -= 1;
    if (this.#pauses === 0) this.#arm();
  }

  stop() {
    this.#stopped = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }

  #arm() {
    if (this.#stopped) return;
    this.#startedAt = Date.now();
    this.#timer = setTimeout(this.#onExpire, Math.max(0, this.#remaining));
  }
}
