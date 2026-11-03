import { DomainError, type Repo, type Task, type TaskRefs } from '@shinsa/core';
import { Effect } from 'effect';
import { edgeRuntime } from '../runtime/edge.ts';
import { History } from './history/service.ts';

export { resolveTaskCheckout } from './history/checkout.ts';

export function resolveTaskRefs(
  repo: Repo,
  task: Task,
  baseBranch: string | null,
  signal?: AbortSignal
): Promise<TaskRefs> {
  return edgeRuntime.runPromise(
    History.use((history) => history.taskRefs(repo, task, baseBranch, signal)).pipe(
      Effect.catchTag('CodeUnavailable', (missing) =>
        Effect.fail(new DomainError({ code: 'code_unavailable', message: missing.message }))
      )
    )
  );
}
