import { Effect } from 'effect';
import type { ReconnectPlan, SocketDrop } from './schema.ts';

export function keepDialing<D extends SocketDrop, R>(dial: Effect.Effect<never, D, R>, plan: ReconnectPlan) {
  const attempt = (schedule: ReconnectPlan['first']) =>
    Effect.flip(Effect.retry(dial, { schedule, while: (drop) => !drop.connected && !drop.final }));
  const again = Effect.andThen(Effect.sleep(plan.redial), attempt(plan.backoff));
  return Effect.flatMap(attempt(plan.first), (drop) =>
    drop.final ? Effect.succeed(drop) : Effect.repeat(again, { until: (next) => next.final })
  );
}
