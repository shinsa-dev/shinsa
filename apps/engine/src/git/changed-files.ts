import type { Repo, Task } from '@shinsa/core';
import { edgeRuntime } from '../runtime/edge.ts';
import { History } from './history/service.ts';

export function listChangedFiles(repo: Repo, task: Task, baseBranch: string | null, signal?: AbortSignal) {
  return edgeRuntime.runPromise(
    History.use((history) => history.changedFiles(repo, task, baseBranch, signal))
  );
}
