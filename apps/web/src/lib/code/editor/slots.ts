export class SlotRegistry {
  readonly #slots = new Map<string, HTMLElement>();
  readonly #listeners = new Set<() => void>();
  #snapshot: ReadonlyMap<string, HTMLElement> = new Map();

  register(key: string, element: HTMLElement) {
    this.#slots.set(key, element);
    this.#publish();
  }

  release(key: string, element: HTMLElement) {
    if (this.#slots.get(key) !== element) return;
    this.#slots.delete(key);
    this.#publish();
  }

  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  read = () => this.#snapshot;

  #publish() {
    this.#snapshot = new Map(this.#slots);
    for (const listener of this.#listeners) listener();
  }
}

export function createSlotElement(key: string, registry: SlotRegistry) {
  const element = document.createElement('div');
  element.className = 'cm-note-slot';
  element.dataset.slot = key;
  registry.register(key, element);
  return element;
}
