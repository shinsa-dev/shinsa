import type { Task } from '@shinsa/core';
import {
  requestFileContent,
  requestRepoTree,
  requestTaskDiff,
  requestTaskRefs,
} from '@/lib/connection/code.ts';
import { listRepoDirs, listRepoPaths } from './demo-repo.ts';

export async function primeReview(task: Task) {
  const refs = await requestTaskRefs(task);
  const commits = refs.base ? [refs.head, refs.base] : [refs.head];
  const reads: Promise<unknown>[] = commits.flatMap((ref) => [
    ...listRepoDirs(ref).map((dir) => requestRepoTree(task, ref, dir)),
    ...listRepoPaths(ref).map((path) => requestFileContent(task, ref, path)),
  ]);
  if (refs.base) reads.push(requestTaskDiff(task, refs.base, refs.head));
  await Promise.all(reads);
}
