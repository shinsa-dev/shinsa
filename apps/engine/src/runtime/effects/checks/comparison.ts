import { type Repo, resolveRoundBase, type Task } from '@shinsa/core';
import { Effect } from 'effect';
import type { BaseCheckouts } from '../../../checks/base.ts';
import { type BaseComparison, CHECK_TIMEOUT_MS } from '../../../checks/index.ts';
import { History } from '../../../git/history/service.ts';
import { edgeRuntime } from '../../edge.ts';

export function createBaseComparison(
  bases: BaseCheckouts,
  task: Task,
  repo: Repo,
  cwd: string,
  env: Record<string, string>,
  signal: AbortSignal
): BaseComparison {
  const base = edgeRuntime.runSync(
    Effect.cached(
      History.use((history) => history.taskRefs(repo, task, resolveRoundBase(task), signal)).pipe(
        Effect.map((refs) => refs.base)
      )
    )
  );
  const resolveBase = () => edgeRuntime.runPromise(base);
  return (run) =>
    bases.compareWithBase({ repo, resolveBase, cwd, run, timeoutMs: CHECK_TIMEOUT_MS, signal, env });
}
