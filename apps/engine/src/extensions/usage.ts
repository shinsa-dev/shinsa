import { Effect, Scope } from 'effect';
import { edgeRuntime } from '../runtime/edge.ts';
import { USAGE_CHUNK_BYTES, USAGE_HORIZON_DAYS } from './schema.ts';
import type { UsageIndexHandle, UsageIndexOptions, UsageRefresh } from './usage-index/schema.ts';
import { makeUsageIndex } from './usage-index/service.ts';

export { normalizeServerName, resolveServerLabel } from './usage/names.ts';
export type { UsageIndexOptions } from './usage-index/schema.ts';

export class UsageIndex {
  readonly #handle: UsageIndexHandle;
  #joined: { refresh: UsageRefresh; promise: Promise<void> } | null = null;

  constructor(options: UsageIndexOptions) {
    const now = options.now ?? Date.now;
    this.#handle = edgeRuntime.runSync(
      makeUsageIndex({
        sources: options.sources,
        cachePath: options.cachePath,
        now: Effect.sync(now),
        horizonDays: options.horizonDays ?? USAGE_HORIZON_DAYS,
        chunkBytes: options.chunkBytes ?? USAGE_CHUNK_BYTES,
      }).pipe(Scope.provide(edgeRuntime.runSync(Scope.make())))
    );
  }

  read() {
    return edgeRuntime.runSync(this.#handle.read);
  }

  selectServer(runtimeName: string) {
    return edgeRuntime.runSync(this.#handle.selectServer(runtimeName));
  }

  selectSkill(name: string) {
    return edgeRuntime.runSync(this.#handle.selectSkill(name));
  }

  isStale(maxAgeMs: number) {
    return edgeRuntime.runSync(this.#handle.isStale(maxAgeMs));
  }

  refresh() {
    const refresh = edgeRuntime.runSync(this.#handle.refresh);
    if (this.#joined?.refresh !== refresh) {
      this.#joined = { refresh, promise: edgeRuntime.runPromise(this.#handle.join(refresh)) };
    }
    return this.#joined.promise;
  }

  stop() {
    return edgeRuntime.runPromise(this.#handle.stop);
  }
}
