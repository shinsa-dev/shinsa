import { Effect } from 'effect';
import { edgeRuntime } from '../runtime/edge.ts';
import type { LogFields } from './schema.ts';

export { describeError, redactSecrets } from './redact.ts';

function write(entry: Effect.Effect<void>, fields: LogFields = {}) {
  edgeRuntime.runSync(entry.pipe(Effect.annotateLogs(fields)));
}

export const log = {
  info: (message: string, fields?: LogFields) => write(Effect.logInfo(message), fields),
  warn: (message: string, fields?: LogFields) => write(Effect.logWarning(message), fields),
  error: (message: string, fields?: LogFields) => write(Effect.logError(message), fields),
};
