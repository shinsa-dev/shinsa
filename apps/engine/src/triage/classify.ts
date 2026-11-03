import { Effect } from 'effect';
import type { QuickJson } from '../agents/quick/index.ts';
import { describeError } from '../log/redact.ts';
import { ClassifierFailed, type QuickAsk } from './schema.ts';

export function resolveQuickAsk(ask: QuickJson): QuickAsk {
  return <T>(system: string, prompt: string, schema: Parameters<QuickJson>[2]) =>
    Effect.tryPromise({
      try: () => ask<T>(system, prompt, schema),
      catch: (cause) => new ClassifierFailed({ message: describeError(cause) }),
    });
}
