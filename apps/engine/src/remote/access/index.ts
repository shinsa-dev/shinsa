import { Effect, ManagedRuntime } from 'effect';
import { AccessScope } from './service.ts';

export class RemoteAccessScope {
  readonly #runtime = ManagedRuntime.make(AccessScope.layer);

  acquire(close: () => void) {
    const lease = this.#runtime.runSync(AccessScope.use((scope) => scope.acquire(Effect.sync(close))));
    return () => this.#runtime.runSync(lease.release);
  }

  get isOpen() {
    return this.#runtime.runSync(AccessScope.use((scope) => scope.isOpen));
  }

  end() {
    this.#runtime.runSync(AccessScope.use((scope) => scope.end));
  }
}
