import { type Queue, parseBriefing, resolveFallbackBriefing, type ShinsaState } from '@shinsa/core';
import { Effect, Option } from 'effect';
import type { JsonSchema } from '../agents/providers/index.ts';
import { describeBriefingPrompt, resolveBriefingSchema, resolveTaskQuestion } from './prompt.ts';
import { BRIEFING_SYSTEM } from './schema.ts';

export const resolveBriefingAnswer = Effect.fn('Briefings.resolve')(function* <E>(
  state: ShinsaState,
  queue: Queue,
  now: number,
  ask: (system: string, prompt: string, schema: JsonSchema) => Effect.Effect<unknown, E>
) {
  const fallback = resolveFallbackBriefing(queue, now);
  if (queue.ready.length === 0) return fallback;
  const answer = yield* ask(
    BRIEFING_SYSTEM,
    describeBriefingPrompt(state, queue, now),
    resolveBriefingSchema(resolveTaskQuestion(queue))
  );
  return Option.getOrUndefined(parseBriefing(answer, queue, now)) ?? fallback;
});
