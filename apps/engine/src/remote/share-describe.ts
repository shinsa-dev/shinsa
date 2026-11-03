import { Effect } from 'effect';
import type { QuickJson } from '../agents/quick/index.ts';
import { describeError } from '../log/index.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import { type ShareDescriber, ShareDescribeFailed } from './share-describe/schema.ts';
import { makeShareDescriber } from './share-describe/service.ts';

export { describeSharePrompt } from './share-describe/prompt.ts';
export type { ShareDescriber } from './share-describe/schema.ts';

export function createShareDescriber(ask: QuickJson): ShareDescriber {
  const describe = edgeRuntime.runSync(
    makeShareDescriber({
      ask: (system, prompt, schema) =>
        Effect.tryPromise({
          try: () => ask<unknown>(system, prompt, schema),
          catch: (error) => new ShareDescribeFailed({ message: describeError(error) }),
        }),
    })
  );
  return (task) => edgeRuntime.runPromise(describe(task));
}
