import type { Task } from '@shinsa/core';
import { Effect, Option } from 'effect';
import { isPresent } from '../../files/probe.ts';

export const selectTaskCheckout = Effect.fn('History.selectTaskCheckout')(function* (
  task: Pick<Task, 'workspace' | 'worktreePath'>
) {
  if (!task.worktreePath) return Option.none<string>();
  return (yield* isPresent(task.worktreePath)) ? Option.some(task.worktreePath) : Option.none<string>();
});
