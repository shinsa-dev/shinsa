import { type Repo, resolveRoundBase, type Task } from '@shinsa/core';
import type { BaseCheckouts } from '../../../checks/base.ts';
import { type BaseComparison, CHECK_TIMEOUT_MS } from '../../../checks/index.ts';
import { resolveTaskRefs } from '../../../git/task-refs.ts';

export function createBaseComparison(
  bases: BaseCheckouts,
  task: Task,
  repo: Repo,
  cwd: string,
  env: Record<string, string>,
  signal: AbortSignal
): BaseComparison {
  let base: Promise<string | null> | null = null;
  const resolveBase = () => {
    base ??= resolveTaskRefs(repo, task, resolveRoundBase(task), signal).then((refs) => refs.base);
    return base;
  };
  return (run) =>
    bases.compareWithBase({ repo, resolveBase, cwd, run, timeoutMs: CHECK_TIMEOUT_MS, signal, env });
}
