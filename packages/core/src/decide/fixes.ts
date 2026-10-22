import type { CommandOf } from '../commands/index.ts';
import type { FixReason, Task } from '../model/index.ts';
import { resolveChecksFixPrompt, resolveReviewFixPrompt } from '../prompts/index.ts';
import type { ReportCheck, ReviewFinding } from '../report/types.ts';
import type { Decider } from './decider.ts';
import { openReviewGate, startReview } from './lifecycle.ts';

const MAX_STALLED_FIXES = 2;

const AUTO_FIX_CEILING = 12;

const FIX_STAGE_REASON: Record<FixReason, string> = {
  checks: 'fixing failing checks',
  review: 'fixing review findings',
  you: 'making your changes',
  pull_request: 'fixing the pull request',
};

function resolveSignature(parts: string[]) {
  return [...new Set(parts)].sort().join('\n');
}

function countRepeats(task: Task, reason: FixReason, signature: string | null) {
  if (signature === null) return 0;
  const key = `${reason}:${signature}`;
  return (task.fixHistory ?? []).filter((entry) => entry === key).length;
}

function isBudgetSpent(task: Task) {
  return task.fixRounds > 0 || (task.fixHistory ?? []).length > 0;
}

export function resetFixBudget(decider: Decider, taskId: string) {
  const task = decider.task(taskId);
  if (!isBudgetSpent(task)) return;
  decider.emit({ type: 'fix.started', taskId, round: 0, ...(task.fixFor ? { reason: task.fixFor } : {}) });
}

export function clearFixLoop(decider: Decider, taskId: string) {
  const task = decider.task(taskId);
  if (!isBudgetSpent(task) && task.fixFor === null) return;
  decider.emit({ type: 'fix.started', taskId, round: 0 });
}

function stopFixing(decider: Decider, task: Task, stalled: number) {
  const limit = decider.state.settings.maxFixRounds ?? AUTO_FIX_CEILING;
  if (stalled >= MAX_STALLED_FIXES) {
    decider.fail(
      task.id,
      'Fixing is not making progress',
      `The same problems came back after ${stalled} fix rounds. Steer the agent in the chat, or retry.`
    );
    return true;
  }
  if (task.fixRounds >= limit) {
    decider.fail(
      task.id,
      'Out of automatic fix rounds',
      `${limit} fix rounds did not get it clean. Retry to give the agent more rounds, or steer it in the chat.`
    );
    return true;
  }
  return false;
}

export function startFix(
  decider: Decider,
  taskId: string,
  reason: FixReason,
  prompt: string,
  signature: string | null
) {
  const task = decider.task(taskId);
  const stalled = countRepeats(task, reason, signature);
  if (reason !== 'you' && stopFixing(decider, task, stalled)) return;
  const round = reason === 'you' ? 0 : task.fixRounds + 1;
  decider.emit({ type: 'fix.started', taskId, round, reason, signature, stalled });
  decider.stage(taskId, 'fixing', FIX_STAGE_REASON[reason]);
  decider.startRun(decider.task(taskId), 'fixer', prompt, {
    resumeFrom: decider.lastRun(taskId, ['fixer', 'builder', 'shipper']),
  });
}

function reactToChecks(decider: Decider, taskId: string, results: ReportCheck[]) {
  const failed = results.filter((check) => check.outcome === 'fail');
  if (failed.length === 0) {
    decider.progressed(taskId);
    startReview(decider, taskId);
    return;
  }
  startFix(
    decider,
    taskId,
    'checks',
    resolveChecksFixPrompt(results),
    resolveSignature(failed.map((check) => check.name))
  );
}

export function reactToFindings(decider: Decider, taskId: string, findings: ReviewFinding[]) {
  const blocking = findings.filter((finding) => finding.severity === 'blocking');
  if (blocking.length === 0) {
    openReviewGate(decider, taskId);
    return;
  }
  startFix(
    decider,
    taskId,
    'review',
    resolveReviewFixPrompt(findings),
    resolveSignature(blocking.map((finding) => finding.file ?? ''))
  );
}

export function recordChecks(decider: Decider, command: CommandOf<'checks.record'>) {
  if (decider.task(command.taskId).stage !== 'checking') return;
  decider.emit({ type: 'checks.recorded', taskId: command.taskId, results: command.results });
  reactToChecks(decider, command.taskId, command.results);
}
