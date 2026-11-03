import { tmpdir } from 'node:os';
import type { AgentModel } from '@shinsa/core';
import { Duration, Effect } from 'effect';
import { edgeRuntime } from '../../../runtime/edge.ts';
import { CATALOG_TIMEOUT_MS, type CodexModelCatalogHandle } from './models/schema.ts';
import { makeCodexModelCatalog } from './models/service.ts';
import { CODEX_RUNTIME } from './session.ts';
import type { CodexRuntime } from './session/schema.ts';

export { resolveCodexModels } from './models/rows.ts';

export class CodexModelCatalog {
  readonly #handle: CodexModelCatalogHandle;

  constructor(runtime: CodexRuntime = CODEX_RUNTIME, timeoutMs = CATALOG_TIMEOUT_MS) {
    this.#handle = edgeRuntime.runSync(
      makeCodexModelCatalog({
        executable: Effect.promise(() => runtime.resolveExecutable()),
        env: runtime.env,
        cwd: tmpdir(),
        timeout: Duration.millis(timeoutMs),
      })
    );
  }

  list(): Promise<AgentModel[]> {
    return edgeRuntime.runPromise(this.#handle.list);
  }
}
