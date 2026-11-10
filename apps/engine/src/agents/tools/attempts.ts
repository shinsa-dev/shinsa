import type { Validation } from '@shinsa/core';
import { Effect } from 'effect';
import { describeError } from '../../log/index.ts';
import { resolveHandOver } from '../handover.ts';
import { ToolCallFailed } from './schema.ts';

export function assertToolInput<T>(validation: Validation<T>) {
  return Effect.fromResult(resolveHandOver(validation)).pipe(
    Effect.mapError((error) => new ToolCallFailed({ message: describeError(error) }))
  );
}
