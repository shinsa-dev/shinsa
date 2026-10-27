export class SlotRegistry {
  readonly #slots = new Map<string, HTMLElement>();
  readonly #heights = new Map<string, number>();

  select(key: string) {
    return this.#slots.get(key) ?? null;
  }

  upsert(key: string) {
    const known = this.#slots.get(key);
    if (known) return known;
    const element = document.createElement('div');
    element.className = 'cm-note-slot';
    element.dataset.slot = key;
    this.#slots.set(key, element);
    return element;
  }

  retain(keys: ReadonlySet<string>) {
    for (const [key, element] of this.#slots) {
      if (keys.has(key)) continue;
      element.remove();
      this.#slots.delete(key);
      this.#heights.delete(key);
    }
  }

  recordHeight(key: string, height: number) {
    if (height > 0) this.#heights.set(key, height);
  }

  readHeight(key: string) {
    return this.#heights.get(key) ?? -1;
  }

  list() {
    return [...this.#slots.values()];
  }
}

export function attachSlot(key: string, registry: SlotRegistry) {
  const block = document.createElement('div');
  block.className = 'cm-note-block';
  block.appendChild(registry.upsert(key));
  return block;
}

export function detachSlot(key: string, registry: SlotRegistry, block: HTMLElement) {
  const slot = registry.select(key);
  if (slot?.parentElement !== block) return;
  registry.recordHeight(key, slot.offsetHeight);
  slot.remove();
}
