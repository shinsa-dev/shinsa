import type { AgentModel } from '@shinsa/core';
import { Duration } from 'effect';
import { edgeRuntime } from '../../../runtime/edge.ts';
import { CATALOG_TIMEOUT_MS, type ModelCatalogHandle } from './models/schema.ts';
import { makeModelCatalog } from './models/service.ts';
import { CLAUDE_RUNTIME, type ClaudeRuntime } from './sdk.ts';

export { resolveModels } from './models/families.ts';

export class ModelCatalog {
  readonly #handle: ModelCatalogHandle;

  constructor(runtime: ClaudeRuntime = CLAUDE_RUNTIME, timeoutMs = CATALOG_TIMEOUT_MS) {
    this.#handle = edgeRuntime.runSync(makeModelCatalog({ runtime, timeout: Duration.millis(timeoutMs) }));
  }

  list(): Promise<AgentModel[]> {
    return edgeRuntime.runPromise(this.#handle.list);
  }
}
