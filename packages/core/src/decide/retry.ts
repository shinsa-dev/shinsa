import type { Decider } from './decider.ts';
import { resetFixBudget } from './fixes.ts';
import {
  resolveCurrentPhase,
  startChecks,
  startPhase,
  startPlanning,
  startReview,
  startWork,
} from './lifecycle.ts';
import { recheckPullRequest, requestPush } from './pull-requests.ts';

function dropCancelledDependencies(decider: Decider, taskId: string) {
  const task = decider.task(taskId);
  const kept = task.blockedBy.filter((id) => decider.state.tasks[id]?.stage !== 'cancelled');
  if (kept.length === task.blockedBy.length) return;
  decider.emit({ type: 'task.blocked', taskId, blockedBy: kept, by: 'you' });
}

export function retryTask(decider: Decider, taskId: string, guidance: string | null) {
  decider.withdrawGates(taskId, (gate) => gate.purpose === 'failure');
  resetFixBudget(decider, taskId);
  const hint = guidance ? `\n\nGuidance from the human: ${guidance}` : '';
  const task = decider.task(taskId);
  switch (task.stage) {
    case 'triage':
      decider.cancelRuns(taskId);
      if (task.branch) startWork(decider, taskId);
      else decider.run({ kind: 'task.triage', taskId });
      return;
    case 'queued':
      dropCancelledDependencies(decider, taskId);
      startWork(decider, taskId);
      return;
    case 'planning':
    case 'awaiting_spec':
      decider.withdrawGates(taskId, (gate) => gate.kind === 'spec');
      startPlanning(decider, taskId, guidance);
      return;
    case 'building':
      startPhase(decider, taskId, resolveCurrentPhase(task), decider.lastRun(taskId, ['builder']), hint);
      return;
    case 'checking':
      startChecks(decider, taskId);
      return;
    case 'reviewing':
      startReview(decider, taskId);
      return;
    case 'fixing':
      decider.startRun(
        task,
        'fixer',
        `Continue the fix you were working on and finish with \`complete_fix\`.${hint}`,
        {
          resumeFrom: decider.lastRun(taskId, ['fixer', 'builder', 'shipper']),
        }
      );
      return;
    case 'shipping':
      decider.cancelRuns(taskId);
      requestPush(decider, taskId);
      return;
    case 'awaiting_merge':
      decider.cancelRuns(taskId);
      recheckPullRequest(decider, taskId);
      return;
    case 'awaiting_review':
    case 'merged':
    case 'done':
    case 'cancelled':
      return;
  }
}
