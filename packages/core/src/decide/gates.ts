import { DomainError, type Gate, type GateDecision, type GatePurpose } from '../model/index.ts';
import { resolveHumanFixPrompt } from '../prompts/index.ts';
import type { Decider } from './decider.ts';
import { clearFixLoop, startFix } from './fixes.ts';
import { settleTask, startPhase, startPlanning } from './lifecycle.ts';
import { requestPush } from './pull-requests.ts';
import { retryTask } from './retry.ts';

const ALLOWED_DECISIONS: Record<GatePurpose, { decisions: GateDecision[]; message: string }> = {
  decision: {
    decisions: ['approve', 'revise', 'reject'],
    message: 'Approve it, ask for changes or reject it.',
  },
  agent_question: { decisions: ['answer'], message: 'Answer the question.' },
  failure: { decisions: ['approve', 'answer', 'reject'], message: 'Retry or cancel the task.' },
};

function findOpenGate(decider: Decider, gateId: string) {
  const gate = decider.state.gates[gateId];
  if (!gate) throw new DomainError('gate_not_found', `No gate ${gateId}`);
  if (gate.status !== 'open') throw new DomainError('gate_closed', 'This has already been answered.');
  return gate;
}

function assertDecision(gate: Gate, decision: GateDecision, response: string | null) {
  const allowed = ALLOWED_DECISIONS[gate.purpose];
  if (!allowed.decisions.includes(decision)) throw new DomainError('decision_invalid', allowed.message);
  if (gate.purpose === 'agent_question' && !response?.trim()) {
    throw new DomainError('answer_required', 'Write an answer first.');
  }
}

function answerQuestion(decider: Decider, gate: Gate, response: string | null) {
  const asker = gate.runId ? decider.state.runs[gate.runId] : undefined;
  if (asker && asker.endedAt === null) {
    decider.run({ kind: 'question.resolve', gateId: gate.id });
    return;
  }
  retryTask(decider, gate.taskId, `You asked: ${gate.title}\nThe human answered: ${response ?? ''}`);
}

function answerFailure(decider: Decider, gate: Gate, decision: GateDecision, response: string | null) {
  if (decision === 'reject') {
    settleTask(decider, gate.taskId, 'cancelled', 'cancelled after a failure');
    return;
  }
  decider.progressed(gate.taskId);
  retryTask(decider, gate.taskId, response);
}

function approveReview(decider: Decider, taskId: string) {
  clearFixLoop(decider, taskId);
  const reason = decider.task(taskId).pullRequest ? 'pushing the changes' : 'opening the pull request';
  decider.stage(taskId, 'shipping', reason);
  requestPush(decider, taskId);
}

function answerDecision(decider: Decider, gate: Gate, decision: GateDecision, response: string | null) {
  const taskId = gate.taskId;
  if (decision === 'reject') {
    settleTask(decider, taskId, 'cancelled', `${gate.kind} rejected`);
    return;
  }
  if (decision === 'revise' && gate.kind === 'spec') {
    startPlanning(decider, taskId, response ?? 'Revise the plan.');
    return;
  }
  if (decision === 'revise') {
    startFix(decider, taskId, 'you', resolveHumanFixPrompt(response ?? 'Revise the work.'), null);
    return;
  }
  if (gate.kind === 'spec') {
    if (response?.trim()) decider.emit({ type: 'spec.answered', taskId, answers: response.trim() });
    startPhase(decider, taskId, 0);
    return;
  }
  if (gate.kind === 'review') {
    approveReview(decider, taskId);
    return;
  }
  if (gate.kind === 'merge') {
    decider.stage(taskId, 'awaiting_merge', 'merging');
    decider.run({ kind: 'pull_request.merge', taskId });
  }
}

export function answerGate(
  decider: Decider,
  gateId: string,
  decision: GateDecision,
  response: string | null
) {
  const gate = findOpenGate(decider, gateId);
  assertDecision(gate, decision, response);
  decider.emit({ type: 'gate.answered', gateId, decision, response });
  decider.requestBriefing(gate.taskId);
  switch (gate.purpose) {
    case 'agent_question':
      answerQuestion(decider, gate, response);
      return;
    case 'failure':
      answerFailure(decider, gate, decision, response);
      return;
    case 'decision':
      answerDecision(decider, gate, decision, response);
      return;
  }
}
