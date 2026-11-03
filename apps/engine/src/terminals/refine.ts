import type { ServiceSuggestion } from '@shinsa/core';
import { Effect } from 'effect';
import type { QuickJson } from '../agents/quick/index.ts';
import { describeError } from '../log/index.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import { ServiceRefineFailed, type ServiceRefinerHandle } from './refine/schema.ts';
import { makeServiceRefiner } from './refine/service.ts';

export { parseRefinedEntries } from './answer.ts';
export { readFolderDigest, resolveRefinedSuggestions } from './refine/suggestions.ts';
export { REFINE_LIMITS } from './schema.ts';

export class ServiceRefiner {
  readonly #handle: ServiceRefinerHandle;

  constructor(ask: QuickJson) {
    this.#handle = edgeRuntime.runSync(
      makeServiceRefiner({
        ask: (system, prompt, schema) =>
          Effect.tryPromise({
            try: () => ask<unknown>(system, prompt, schema),
            catch: (error) => new ServiceRefineFailed({ message: describeError(error) }),
          }),
      })
    );
  }

  refine(projectId: string, candidates: ServiceSuggestion[]) {
    return edgeRuntime.runPromise(this.#handle.refine(projectId, candidates));
  }
}
