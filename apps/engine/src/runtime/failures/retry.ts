import { Duration, Effect, Option, Schedule } from 'effect';
import { EFFECT_RETRY, type EffectRetryInput } from './schema.ts';

export const resolveEffectRetryDelay = Effect.fn('EffectRetry.resolveDelay')(function* (
  attempt: number,
  input: EffectRetryInput
) {
  const step = yield* Schedule.toStep(EFFECT_RETRY);
  let delay = Option.none<number>();
  for (let index = 0; index < attempt; index += 1) {
    const next = yield* Effect.option(step(0, input));
    if (Option.isNone(next)) return Option.none<number>();
    delay = Option.some(Duration.toMillis(next.value[1]));
  }
  return delay;
});
