import type { Task } from '@shinsa/core';
import {
  requestFileContent,
  requestRepoTree,
  requestTaskDiff,
  requestTaskRefs,
} from '@/lib/connection/code.ts';
import { listChangedPaths } from './demo-repo.ts';

export async function primeReview(task: Task) {
  const refs = await requestTaskRefs(task);
  const reads: Promise<unknown>[] = [requestRepoTree(task, refs.head, '')];
  if (refs.base) reads.push(requestTaskDiff(task, refs.base, refs.head));
  for (const path of listChangedPaths()) {
    reads.push(requestFileContent(task, refs.head, path));
    if (refs.base) reads.push(requestFileContent(task, refs.base, path));
  }
  await Promise.all(reads);
}
