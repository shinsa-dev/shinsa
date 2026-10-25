import { isPausingGate } from '../domain/index.ts';
import { resolveAgentPrompt } from '../prompts/index.ts';
import { isTriaged } from '../state/queries.ts';
import { UPDATING_WORKSPACE, updateWorkspace } from './conflicts.ts';
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
import { restartAnswer, startInquiry, startOperation } from './shapes.ts';

function dropCancelledDependencies(decider: Decider, taskId: string) {
  const task = decider.task(taskId);
  const kept = task.waitsOn.filter((id) => decider.state.tasks[id]?.stage !== 'cancelled');
  if (kept.length === task.waitsOn.length) return;
  decider.emit({ type: 'task.waits_on_changed', taskId, waitsOn: kept, by: 'you' });
}

export function retryTask(decider: Decider, taskId: string, guidance: string | null) {
  decider.withdrawGates(taskId, isPausingGate);
  decider.clearWaits(taskId);
  resetFixBudget(decider, taskId);
  const hint = guidance ? `\n\nGuidance from the human: ${guidance}` : '';
  const task = decider.task(taskId);
  switch (task.stage) {
    case 'triage':
      decider.cancelRuns(taskId);
      if (isTriaged(task)) startWork(decider, taskId);
      else decider.run({ kind: 'task.triage', taskId });
      return;
    case 'waiting_on_tasks':
      dropCancelledDependencies(decider, taskId);
      startWork(decider, taskId);
      return;
    case 'planning':
    case 'awaiting_plan':
      decider.withdrawGates(taskId, (gate) => gate.type === 'plan');
      startPlanning(decider, taskId, guidance);
      return;
    case 'building':
      startPhase(decider, taskId, resolveCurrentPhase(task), hint);
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
        'agent',
        resolveAgentPrompt(`Continue the fix you were working on and finish with \`complete_fix\`.${hint}`),
        { purpose: 'fix', resumeFrom: decider.taskSession(taskId, 'agent') }
      );
      return;
    case 'shipping':
      decider.cancelRuns(taskId);
      if (task.stageReason === UPDATING_WORKSPACE) updateWorkspace(decider, taskId, guidance);
      else requestPush(decider, taskId);
      return;
    case 'awaiting_merge':
      decider.cancelRuns(taskId);
      recheckPullRequest(decider, taskId);
      return;
    case 'answering':
      restartAnswer(decider, task, guidance);
      return;
    case 'researching':
      startInquiry(decider, taskId, 'research', guidance);
      return;
    case 'investigating':
      startInquiry(decider, taskId, 'investigate', guidance);
      return;
    case 'operating':
      startOperation(decider, taskId, guidance);
      return;
    case 'awaiting_proposal':
    case 'awaiting_operation':
    case 'awaiting_review':
    case 'merged':
    case 'done':
    case 'cancelled':
      return;
  }
}
