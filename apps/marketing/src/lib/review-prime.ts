import type { Task } from '@shinsa/core';
import { Effect } from 'effect';
import {
  requestFileContent,
  requestRepoTree,
  requestTaskDiff,
  requestTaskRefs,
} from '@/lib/connection/code.ts';
import { listRepoDirs, listRepoPaths } from './demo-repo.ts';

export const primeReview = Effect.fn('primeReview')(function* (task: Task) {
  const refs = yield* Effect.promise(() => requestTaskRefs(task));
  const { base, head } = refs;
  const commits = base ? [head, base] : [head];
  const reads: (() => Promise<unknown>)[] = commits.flatMap((ref) => [
    ...listRepoDirs(task.id, ref).map((dir) => () => requestRepoTree(task, ref, dir)),
    ...listRepoPaths(task.id, ref).map((path) => () => requestFileContent(task, ref, path)),
  ]);
  if (base) reads.push(() => requestTaskDiff(task, base, head));
  yield* Effect.forEach(reads, (read) => Effect.promise(read), { concurrency: 'unbounded', discard: true });
});
