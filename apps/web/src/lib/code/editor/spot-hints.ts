export interface SpotHint {
  id: number;
  element: HTMLElement;
  label: string;
}

export class SpotHintRegistry {
  readonly #hints: Map<HTMLElement, SpotHint>;
  readonly #listeners: Set<() => void>;
  #snapshot: readonly SpotHint[];
  #next: number;
  #queued: boolean;

  constructor() {
    this.#hints = new Map();
    this.#listeners = new Set();
    this.#snapshot = [];
    this.#next = 0;
    this.#queued = false;
  }

  add(element: HTMLElement, label: string) {
    this.#next += 1;
    this.#hints.set(element, { id: this.#next, element, label });
    this.#schedule();
  }

  remove(element: HTMLElement) {
    if (this.#hints.delete(element)) this.#schedule();
  }

  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  read = () => this.#snapshot;

  #schedule() {
    if (this.#queued) return;
    this.#queued = true;
    queueMicrotask(() => {
      this.#queued = false;
      this.#snapshot = [...this.#hints.values()];
      for (const listener of this.#listeners) listener();
    });
  }
}
