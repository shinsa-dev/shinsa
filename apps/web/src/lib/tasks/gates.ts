import {
  type FindingVerdict,
  type Gate,
  type GateDecision,
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
}

const GATE_REPLY = {
  answer: { decision: 'answer', done: 'Answered. The agent carries on.' },
  retry: { decision: 'approve', done: 'Picking it up again.' },
  guide: { decision: 'approve', done: 'Retrying with your guidance.' },
  cancel: { decision: 'reject', done: 'Cancelled.' },
  recheck: { decision: 'approve', done: 'Checking the setup again.' },
  skipChecks: { decision: 'answer', done: 'Starting without checks for this repository.' },
  approvePlan: { decision: 'approve', done: 'Approved. Building now.' },
  approveOperationPlan: { decision: 'approve', done: 'Approved. Running the operation now.' },
  revisePlan: { decision: 'revise', done: 'Sent back to the planner.' },
  approveChanges: { decision: 'approve', done: 'Approved. Opening the pull request.' },
  requestChanges: { decision: 'revise', done: 'Sent back to the agent.' },
  fixFindings: { decision: 'revise', done: 'Sent. The fixer works on what you kept.' },
  merge: { decision: 'approve', done: 'Merging.' },
  makeChange: { decision: 'approve', done: 'Approved. Planning the change now.' },
  planOperation: { decision: 'approve', done: 'Approved. Planning the operation now.' },
  keepAsIs: { decision: 'reject', done: 'Kept as it is. The task is done.' },
  runOperation: { decision: 'approve', done: 'Running the operation.' },
  runOperationWithNotes: { decision: 'answer', done: 'Running the operation with your notes.' },
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
  const task = state.tasks[gate.taskId];
  return (gate.cause === 'budget' && task && describeBudgetRetry(state, task)) || 'Retry';
}

export function resolvePlanReply(task: Task): GateReply {
  return resolveWorkStep(resolveTaskPipeline(task)) === 'operate' ? 'approveOperationPlan' : 'approvePlan';
}
