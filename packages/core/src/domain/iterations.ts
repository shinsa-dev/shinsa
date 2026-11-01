import type { Iteration, Run, RunPurpose, RunRole, Task } from './types.ts';

export type ReplyingHandOver =
  | 'propose_plan'
  | 'complete_phase'
  | 'complete_fix'
  | 'answer'
  | 'report_diagnosis'
  | 'submit_report'
  | 'report_outcome';

const REPLYING_ROLES: ReadonlySet<RunRole> = new Set<RunRole>(['answerer', 'investigator', 'researcher']);

const REPLYING_PURPOSES: ReadonlySet<RunPurpose> = new Set<RunPurpose>(['plan', 'build', 'fix', 'operate']);

export function selectOpenIteration(task: Pick<Task, 'iterations'>): Iteration | null {
  const last = task.iterations?.at(-1);
  return last && last.reply === null ? last : null;
}

export function isReplyingRun(run: Pick<Run, 'role' | 'purpose' | 'delegation'>) {
  if (run.delegation) return false;
  if (REPLYING_ROLES.has(run.role)) return true;
  return run.role === 'agent' && Boolean(run.purpose && REPLYING_PURPOSES.has(run.purpose));
}
