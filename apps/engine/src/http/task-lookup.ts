import type { ShinsaState } from '@shinsa/core';
import { RequestFailed } from '@shinsa/core/engine-api/schema';
import { Effect } from 'effect';
import { listTaskMatches } from './task-views.ts';

export const findTaskByRef = Effect.fn('findTaskByRef')(function* (state: ShinsaState, ref: string) {
  const matches = listTaskMatches(state, ref);
  const [only] = matches;
  if (only && matches.length === 1) return only;
  if (matches.length > 1)
    return yield* new RequestFailed({
      code: 'task_ambiguous',
      message: `“${ref}” matches ${matches.length} tasks. Use the full id.`,
    });
  return yield* new RequestFailed({
    code: 'task_not_found',
    message: `No task ${ref}. \`shinsa tasks list\` lists them.`,
  });
});
