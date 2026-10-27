export interface SpotHint {
  id: number;
  element: HTMLElement;
  label: string;
}

export class SpotHintRegistry {
  readonly #hints = new Map<HTMLElement, SpotHint>();
  readonly #listeners = new Set<() => void>();
  #snapshot: readonly SpotHint[] = [];
  #next = 0;
  #queued = false;

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
