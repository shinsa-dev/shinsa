import type { Iteration, Task } from './types.ts';

export function selectOpenIteration(task: Pick<Task, 'iterations'>): Iteration | null {
  const last = task.iterations?.at(-1);
  return last && last.reply === null ? last : null;
}
