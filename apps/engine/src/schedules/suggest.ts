import { Effect } from 'effect';
import type { QuickJson } from '../agents/quick/index.ts';
import { describeError } from '../log/redact.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import { parseWatchAnswer } from './answer.ts';
import { WATCH_SCHEMA, WATCH_SYSTEM, WatchWordingFailed, type WatchWriter } from './schema.ts';

export type { WatchWriter } from './schema.ts';

export function describeWatchPrompt(server: string, data: string) {
  return [`Integration: ${server}`, `What it holds: ${data}`].join('\n');
}

export function createWatchWriter(ask: QuickJson): WatchWriter {
  return (server, data) =>
    edgeRuntime.runPromise(
      Effect.tryPromise({
        try: () => ask(WATCH_SYSTEM, describeWatchPrompt(server, data), WATCH_SCHEMA),
        catch: (error) => new WatchWordingFailed({ message: describeError(error) }),
      }).pipe(Effect.map(parseWatchAnswer))
    );
}
