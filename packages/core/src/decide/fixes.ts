import type { FixReason, ReviewEscalation, ReviewEscalationReason, Task } from '../domain/index.ts';
import { resolveAgentPrompt, resolveReviewFixPrompt } from '../prompts/index.ts';
import type { ReviewFinding } from '../report/types.ts';
import type { Decider } from './decider.ts';
import { countFixRepeats, countReviewRounds, countUnchangedRounds } from './fingerprints.ts';
import { openReviewGate } from './lifecycle.ts';

const MAX_STALLED_FIXES = 2;

const AUTO_FIX_CEILING = 12;

const MAX_REVIEW_ROUNDS = 3;

const FIX_STAGE_REASON: Record<FixReason, string> = {
  checks: 'fixing failing checks',
  review: 'fixing review findings',
  you: 'making your changes',
  pull_request: 'fixing the pull request',
  conflict: 'resolving conflicts',
};

type FixStop = { reason: Exclude<ReviewEscalationReason, 'rounds'>; stalled: number; limit: number };

function resolveSignature(parts: string[]) {
  return [...new Set(parts)].sort().join('\n');
}

function isBudgetSpent(task: Task) {
  return task.fixRounds > 0 || (task.fixFingerprints ?? []).length > 0;
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

function resolveFixStop(decider: Decider, task: Task, stalled: number): FixStop | null {
  const limit = decider.state.settings.maxFixRounds ?? AUTO_FIX_CEILING;
  if (stalled >= MAX_STALLED_FIXES) return { reason: 'stalled', stalled, limit };
  if (task.fixRounds >= limit) return { reason: 'exhausted', stalled, limit };
  return null;
}

function failFixing(decider: Decider, task: Task, stop: FixStop) {
  if (stop.reason === 'stalled') {
    decider.fail(
      task.id,
      'Fixing is not making progress',
      `The same problems came back after ${stop.stalled} fix rounds. Steer the agent in the chat, or retry.`
    );
    return;
  }
  decider.fail(
    task.id,
    'Out of automatic fix rounds',
    `${stop.limit} fix rounds did not get it clean. Retry to give the agent more rounds, or steer it in the chat.`
  );
}

function escalateReview(decider: Decider, taskId: string, reason: ReviewEscalationReason) {
  const escalation: ReviewEscalation = {
    reason,
    rounds: countReviewRounds(decider.task(taskId)),
    at: decider.context.now,
  };
  decider.emit({ type: 'review.escalated', taskId, escalation });
  openReviewGate(decider, taskId, escalation);
}

function listAgentEvidence(decider: Decider, task: Task) {
  return Object.values(decider.state.evidence)
    .filter(
      (piece) =>
        piece.taskId === task.id &&
        piece.runId !== null &&
        decider.state.runs[piece.runId]?.role === 'agent' &&
        isOfCurrentRound(task, piece)
    )
    .sort((a, b) => a.attachedAt - b.attachedAt);
}

export function startFix(
  decider: Decider,
  taskId: string,
  reason: FixReason,
  prompt: string,
  signature: string | null
) {
  const task = decider.task(taskId);
  const stalled = countFixRepeats(task, reason, signature);
  const stop = reason === 'you' ? null : resolveFixStop(decider, task, stalled);
  if (stop && reason === 'review') {
    escalateReview(decider, taskId, stop.reason);
    return;
  }
  if (stop) {
    failFixing(decider, task, stop);
    return;
  }
  const round = reason === 'you' ? 0 : task.fixRounds + 1;
  decider.emit({
    type: 'fix.started',
    taskId,
    round,
    reason,
    signature,
    stalled,
    treeHash: task.treeHash ?? null,
  });
  decider.stage(taskId, 'fixing', FIX_STAGE_REASON[reason]);
  const evidence = describeEvidenceForFix(listAgentEvidence(decider, task));
  decider.startRun(
    decider.task(taskId),
    'agent',
    resolveAgentPrompt([prompt, evidence].filter(Boolean).join('\n\n')),
    {
      purpose: 'fix',
      resumeFrom: decider.taskSession(taskId, 'agent'),
    }
  );
}

function isDismissed(task: Task, finding: ReviewFinding) {
  return (task.dismissedFindings ?? []).some(
    (dismissed) =>
      dismissed.file === finding.file &&
      dismissed.line === finding.line &&
      dismissed.message === finding.message
  );
}

export function reactToFindings(decider: Decider, taskId: string, findings: ReviewFinding[]) {
  const task = decider.task(taskId);
  const blocking = findings.filter(
    (finding) => finding.severity === 'blocking' && !isDismissed(task, finding)
  );
  if (blocking.length === 0) {
    openReviewGate(decider, taskId);
    return;
  }
  if (countUnchangedRounds(task, 'review') > 0) {
    escalateReview(decider, taskId, 'stalled');
    return;
  }
  if (countReviewRounds(task) >= MAX_REVIEW_ROUNDS - 1) {
    escalateReview(decider, taskId, 'rounds');
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
