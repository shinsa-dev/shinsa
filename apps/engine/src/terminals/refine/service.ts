import type { ServiceSuggestion } from '@shinsa/core';
import { Effect, Ref } from 'effect';
import { parseRefinedEntries } from '../answer.ts';
import type { RefinedSuggestions } from '../schema.ts';
import {
  type CachedRefinement,
  REFINE_SCHEMA,
  REFINE_SYSTEM,
  type ServiceRefinerDefinition,
  type ServiceRefinerHandle,
} from './schema.ts';
import { readFolderDigest, resolveRefinedSuggestions, serializeRefinePrompt } from './suggestions.ts';

export const makeServiceRefiner = Effect.fn('ServiceRefiner.make')(function* (
  definition: ServiceRefinerDefinition
) {
  const cache = yield* Ref.make<ReadonlyMap<string, CachedRefinement>>(new Map());

  const request = Effect.fn('ServiceRefiner.request')(function* (
    candidates: ServiceSuggestion[],
    prompt: string
  ) {
    const entries = parseRefinedEntries(yield* definition.ask(REFINE_SYSTEM, prompt, REFINE_SCHEMA));
    return entries ? resolveRefinedSuggestions(candidates, entries) : null;
  });

  const forget = (projectId: string, cached: CachedRefinement) =>
    Ref.update(cache, (entries) => {
      if (entries.get(projectId) !== cached) return entries;
      const next = new Map(entries);
      next.delete(projectId);
      return next;
    });

  const refine = Effect.fn('ServiceRefiner.refine')(function* (
    projectId: string,
    candidates: ServiceSuggestion[]
  ) {
    const unrefined: RefinedSuggestions = { suggestions: candidates, refined: false };
    if (candidates.length === 0) return unrefined;
    const digests = yield* Effect.sync(() =>
      [...new Set(candidates.map((each) => each.cwd))].map(readFolderDigest)
    );
    const prompt = serializeRefinePrompt(candidates, digests);
    const fresh = yield* Effect.cached(request(candidates, prompt));
    const cached = yield* Ref.modify(
      cache,
      (entries): [CachedRefinement, ReadonlyMap<string, CachedRefinement>] => {
        const known = entries.get(projectId);
        if (known?.fingerprint === prompt) return [known, entries];
        const next = { fingerprint: prompt, answer: fresh };
        return [next, new Map(entries).set(projectId, next)];
      }
    );
    const suggestions = yield* cached.answer.pipe(Effect.tapError(() => forget(projectId, cached)));
    if (suggestions) return { suggestions, refined: true };
    yield* forget(projectId, cached);
    return unrefined;
  });

  const handle: ServiceRefinerHandle = { refine };
  return handle;
});
