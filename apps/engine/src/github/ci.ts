import type { Repo } from '@shinsa/core';
import { edgeRuntime } from '../runtime/edge.ts';
import type { RepoCiCache as RepoCiResolver } from './ci/schema.ts';
import { RepoCiReader } from './ci/service.ts';

export { isCheckWorkflow } from './ci/workflows.ts';

export function readRepoCi(repo: Repo, base: string, signal?: AbortSignal) {
  return edgeRuntime.runPromise(RepoCiReader.use((reader) => reader.read(repo, base, signal)));
}

export class RepoCiCache {
  readonly #cache: RepoCiResolver = edgeRuntime.runSync(RepoCiReader.use((reader) => reader.makeCache));

  resolve(repo: Repo, base: string, signal?: AbortSignal) {
    return edgeRuntime.runPromise(this.#cache.resolve(repo, base, signal));
  }
}
