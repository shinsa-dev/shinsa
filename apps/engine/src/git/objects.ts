interface CachedEntry {
  value: Promise<unknown>;
  bytes: number;
}

const OBJECT_CACHE_BYTES = 64 * 1024 * 1024;

export class ObjectCache {
  readonly #limit: number;
  readonly #entries = new Map<string, CachedEntry>();
  #bytes = 0;

  constructor(limit = OBJECT_CACHE_BYTES) {
    this.#limit = limit;
  }

  get size() {
    return this.#entries.size;
  }

  read<T>(key: string, create: () => Promise<T>, measure: (value: T) => number): Promise<T> {
    const known = this.#entries.get(key);
    if (known) {
      this.#entries.delete(key);
      this.#entries.set(key, known);
      return known.value as Promise<T>;
    }
    const entry: CachedEntry = { value: Promise.resolve(), bytes: 0 };
    const pending = create().then(
      (value) => {
        this.#account(key, entry, measure(value));
        return value;
      },
      (error: unknown) => {
        if (this.#entries.get(key) === entry) this.#entries.delete(key);
        throw error;
      }
    );
    entry.value = pending;
    this.#entries.set(key, entry);
    return pending;
  }

  #account(key: string, entry: CachedEntry, bytes: number) {
    if (this.#entries.get(key) !== entry) return;
    entry.bytes = bytes;
    this.#bytes += bytes;
    for (const [oldest, candidate] of this.#entries) {
      if (this.#bytes <= this.#limit || oldest === key) break;
      this.#entries.delete(oldest);
      this.#bytes -= candidate.bytes;
    }
  }
}
