import {
  type ApprovalPath,
  type FindingVerdict,
  type Gate,
  type GateDecision,
  type ReviewComment,
  resolveApprovalPath,
  resolveTaskPipeline,
  resolveWorkStep,
  type ShinsaState,
  type Task,
} from '@shinsa/core';
import { sendCommandWithToast } from '@/lib/connection/commands.ts';
import { describeBudgetRetry } from '@/lib/tasks/cost.ts';

export interface AnswerExtras {
  planVersion?: number;
  verdicts?: FindingVerdict[];
  comments?: ReviewComment[];
}

const GATE_REPLY = {
  answer: { decision: 'reply', done: 'Answered. The agent carries on.' },
  retry: { decision: 'approve', done: 'Picking it up again.' },
  sendToAgent: { decision: 'approve', done: 'Sent to the agent again.' },
  guide: { decision: 'reply', done: 'Retrying with your guidance.' },
  cancel: { decision: 'reject', done: 'Cancelled.' },
  recheck: { decision: 'approve', done: 'Verifying the setup again.' },
  approvePlan: { decision: 'approve', done: 'Approved. Building now.' },
  approveOperationPlan: { decision: 'approve', done: 'Approved. Running the operation now.' },
  startBacklog: {
    decision: 'approve',
    done: 'Started. Updating the worktree.',
  },
  revisePlan: { decision: 'revise', done: 'Sent back to the agent.' },
  approveChanges: { decision: 'approve', done: 'Approved. Opening the pull request.' },
  pushChanges: { decision: 'approve', done: 'Approved. Pushing the changes.' },
  approveEdits: { decision: 'approve', done: 'Approved. Committing your edits.' },
  requestChanges: { decision: 'revise', done: 'Sent back to the agent.' },
  fixFindings: { decision: 'revise', done: 'Sent. The agent works on what you kept.' },
  merge: { decision: 'approve', done: 'Approved. Merging the pull request.' },
  mergeEdits: {
    decision: 'approve',
    done: 'Approved. Merging once CI passes.',
  },
  makeChange: { decision: 'approve', done: 'Approved. Planning the change now.' },
  planOperation: { decision: 'approve', done: 'Approved. Planning the operation now.' },
  keepAsIs: { decision: 'reject', done: 'Kept as it is. The task is done.' },
  runOperation: { decision: 'approve', done: 'Running the operation.' },
  runOperationWithNotes: { decision: 'reply', done: 'Running the operation with your notes.' },
  runOperationWithoutNotes: { decision: 'reply', done: 'Running the operation without notes.' },
  skipOperation: { decision: 'reject', done: 'Finished without running the operation.' },
} as const satisfies Record<string, { decision: GateDecision; done: string }>;

export type GateReply = keyof typeof GATE_REPLY;

export type GateReplier = (
  reply: GateReply,
  response?: string | null,
  extras?: AnswerExtras
) => Promise<boolean>;

export function replyToGate(
  gate: Gate,
  reply: GateReply,
  response: string | null = null,
  extras: AnswerExtras = {}
) {
  const { decision, done } = GATE_REPLY[reply];
  return sendCommandWithToast({ type: 'gate.answer', gateId: gate.id, decision, response, ...extras }, done);
}

export function resolveRetryLabel(state: ShinsaState, gate: Gate) {
  if (gate.cause === 'push_hook') return 'Send to the agent again';
  const task = state.tasks[gate.taskId];
  return (gate.cause === 'budget' && task && describeBudgetRetry(state, task)) || 'Retry';
}

const RETRY_REPLY: Partial<Record<NonNullable<Gate['cause']>, GateReply>> = {
  push_hook: 'sendToAgent',
};

export function resolveRetryReply(gate: Gate): GateReply {
  return (gate.cause && RETRY_REPLY[gate.cause]) || 'retry';
}

export function resolvePlanReply(task: Task): GateReply {
  if (resolveWorkStep(resolveTaskPipeline(task)) === 'operate') return 'approveOperationPlan';
  return task.backlog ? 'startBacklog' : 'approvePlan';
}

const APPROVAL_REPLY: Record<ApprovalPath, GateReply> = {
  check_edits: 'approveEdits',
  open: 'approveChanges',
  push: 'pushChanges',
  push_edits: 'mergeEdits',
  merge: 'merge',
};

export function resolveApprovalReply(task: Task, gate: Gate, reply: GateReply): GateReply {
  if (reply !== 'approveChanges' && reply !== 'merge') return reply;
  return APPROVAL_REPLY[resolveApprovalPath(task, gate.type === 'merge' ? 'merge' : 'review')];
}
