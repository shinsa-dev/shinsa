interface Holder {
  owner: string;
  count: number;
  released: Promise<void>;
  release: () => void;
}

export class WorkspaceLock {
  readonly #holders = new Map<string, Holder>();

  async acquire(key: string, owner: string, signal?: AbortSignal) {
    for (;;) {
      signal?.throwIfAborted();
      const holder = this.#holders.get(key);
      if (!holder) break;
      if (holder.owner === owner) {
        holder.count += 1;
        return this.#releaser(key, holder);
      }
      await this.#wait(holder.released, signal);
    }
    const released = Promise.withResolvers<void>();
    const holder: Holder = { owner, count: 1, released: released.promise, release: released.resolve };
    this.#holders.set(key, holder);
    return this.#releaser(key, holder);
  }

  selectOwner(key: string) {
    return this.#holders.get(key)?.owner ?? null;
  }

  #releaser(key: string, holder: Holder) {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      holder.count -= 1;
      if (holder.count > 0) return;
      this.#holders.delete(key);
      holder.release();
    };
  }

  #wait(released: Promise<void>, signal?: AbortSignal) {
    if (!signal) return released;
    const aborted = Promise.withResolvers<void>();
    const stop = () => aborted.reject(signal.reason);
    signal.addEventListener('abort', stop, { once: true });
    return Promise.race([released, aborted.promise]).finally(() => signal.removeEventListener('abort', stop));
  }
}
