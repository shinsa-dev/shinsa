import type { Task } from '@shinsa/core';

export function canSkipChecks(task: Task) {
  const problems = task.configProblems ?? [];
  return problems.length > 0 && problems.every((problem) => problem.kind === 'check_commands');
}
