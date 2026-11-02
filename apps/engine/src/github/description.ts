import type { Evidence, Repo, Task } from '@shinsa/core';
import { edgeRuntime } from '../runtime/edge.ts';
import type { EvidenceStore } from '../store/evidence/index.ts';
import type { DescriptionWriter } from './description/schema.ts';
import { PullRequestDescriber } from './description/service.ts';

export { serializeReviewLink } from './description/link.ts';

export class PullRequestDescriptions {
  readonly #writer: DescriptionWriter;

  constructor(evidence: EvidenceStore) {
    this.#writer = edgeRuntime.runSync(
      PullRequestDescriber.use((describer) => describer.make((relative) => evidence.selectFile(relative)))
    );
  }

  describe(repo: Repo, task: Task, evidence: readonly Evidence[], signal?: AbortSignal) {
    return edgeRuntime.runPromise(this.#writer.describe(repo, task, evidence, signal));
  }
}
