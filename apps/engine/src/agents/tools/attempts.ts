import { Effect } from 'effect';
import { describeError } from '../../log/index.ts';
import { assertProtocol } from '../handover.ts';
import { ToolCallFailed } from './schema.ts';

function failCall(error: unknown) {
  return new ToolCallFailed({ message: describeError(error) });
}

export function assertToolInput<T>(result: { ok: true; value: T } | { ok: false; errors: string[] }) {
  return Effect.try({ try: () => assertProtocol(result), catch: failCall });
}

export function requestToolCall<T>(request: () => Promise<T>) {
  return Effect.tryPromise({ try: request, catch: failCall });
}
