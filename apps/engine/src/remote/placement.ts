import { Effect } from 'effect';
import type { QuickJson } from '../agents/quick/index.ts';
import { describeError } from '../log/index.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import { type PlacementAsker, PlacementAskFailed } from './placement/schema.ts';
import { makePlacementAsker } from './placement/service.ts';

export type { PlacementAsker } from './placement/schema.ts';

export function createPlacementAsker(ask: QuickJson): PlacementAsker {
  const place = edgeRuntime.runSync(
    makePlacementAsker({
      ask: (system, prompt, schema) =>
        Effect.tryPromise({
          try: () => ask<unknown>(system, prompt, schema),
          catch: (error) => new PlacementAskFailed({ message: describeError(error) }),
        }),
    })
  );
  return (question) => edgeRuntime.runPromise(place(question));
}
