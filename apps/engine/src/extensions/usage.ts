import type { ExtensionUsageRead } from '@shinsa/core';
import { edgeRuntime } from '../runtime/edge.ts';
import { USAGE_CHUNK_BYTES, USAGE_HORIZON_DAYS, type UsageFile, type UsageSource } from './schema.ts';
import { ExtensionFiles } from './store/service.ts';
import { normalizeServerName, resolveServerLabel } from './usage/names.ts';
import { ExtensionUsage } from './usage/service.ts';

export { normalizeServerName, resolveServerLabel } from './usage/names.ts';

export interface UsageIndexOptions {
  sources: UsageSource[];
  cachePath: string | null;
  now?: () => number;
  horizonDays?: number;
  chunkBytes?: number;
}

export class UsageIndex {
  readonly #options: UsageIndexOptions;
  readonly #now: () => number;
  readonly #stop = new AbortController();
  #file: UsageFile;
  #running: Promise<void> | null = null;

  constructor(options: UsageIndexOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.#file = edgeRuntime.runSync(ExtensionFiles.use((files) => files.readUsage(options.cachePath)));
  }

  read(): ExtensionUsageRead {
    return { readAt: this.#file.readAt, since: this.#file.since };
  }

  selectServer(runtimeName: string) {
    const name = normalizeServerName(runtimeName);
    const exact = this.#file.servers[name] ?? null;
    const labelled = this.#file.labels[resolveServerLabel(name)] ?? null;
    if (exact === null) return labelled;
    return labelled === null ? exact : Math.max(exact, labelled);
  }

  selectSkill(name: string) {
    return this.#file.skills[name] ?? null;
  }

  isStale(maxAgeMs: number) {
    return this.#file.readAt === null || this.#now() - this.#file.readAt > maxAgeMs;
  }

  refresh() {
    this.#running ??= this.#scan().finally(() => {
      this.#running = null;
    });
    return this.#running;
  }

  stop() {
    this.#stop.abort();
    return this.#running ?? Promise.resolve();
  }

  async #scan() {
    const {
      sources,
      cachePath,
      horizonDays = USAGE_HORIZON_DAYS,
      chunkBytes = USAGE_CHUNK_BYTES,
    } = this.#options;
    const { signal } = this.#stop;
    try {
      this.#file = await edgeRuntime.runPromise(
        ExtensionUsage.use((usage) =>
          usage.scan({ sources, cachePath, now: this.#now(), horizonDays, chunkBytes }, this.#file)
        ),
        { signal }
      );
    } catch (error) {
      if (!signal.aborted) throw error;
    }
  }
}
