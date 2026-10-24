import {
  DomainError,
  type FindingVerdict,
  type Gate,
  type GateDecision,
  isTaskSettled,
  resolveGateDefinition,
} from '../domain/index.ts';
import { resolveHumanFixPrompt, resolveVerdictFixPrompt } from '../prompts/index.ts';
import type { ShinsaState } from '../state/project.ts';
import { listOpenGates } from '../state/queries.ts';
import { answerConfiguration, assertConfigurationAnswer } from './config.ts';
import { acknowledgeBudget } from './costs.ts';
import type { Decider } from './decider.ts';
import { clearFixLoop, startFix } from './fixes.ts';
import { settleTask, startPlanning } from './lifecycle.ts';
import { requestPush } from './pull-requests.ts';
import { retryTask } from './retry.ts';
import { assertSecretAnswer } from './secrets.ts';
import { answerOperation, answerProposal, startAfterPlan } from './shapes.ts';

interface AnswerOptions {
  planVersion?: number;
  verdicts?: FindingVerdict[];
}

function describePlanChange(decider: Decider, gate: Gate) {
  const current = decider.task(gate.taskId).plan?.version ?? 0;
  if (current > (gate.planVersion ?? current)) {
    return `The plan changed to version ${current} after you opened it. Read the new version and approve that one.`;
  }
  return 'The planner is revising this plan. Approve the new version when it arrives.';
}

function findOpenGate(decider: Decider, gateId: string) {
  const gate = decider.state.gates[gateId];
  if (!gate) throw new DomainError('gate_not_found', `No gate ${gateId}`);
  if (gate.status === 'withdrawn' && gate.type === 'plan' && !isTaskSettled(decider.task(gate.taskId))) {
    throw new DomainError('plan_changed', describePlanChange(decider, gate));
  }
  if (gate.status !== 'open') throw new DomainError('gate_closed', 'This has already been answered.');
  return gate;
}

export function assertGatesStayOpen(decider: Decider, before: ShinsaState) {
  if (!decider.context.onBehalf) return;
  const closed = listOpenGates(before).some((gate) => decider.state.gates[gate.id]?.status !== 'open');
  if (!closed) return;
  throw new DomainError(
    'human_only',
    'This task waits for a decision only the human makes. It waits for them at its gate in Shinsa; tell them it is there.'
  );
}

export function assertHumanDecides(decider: Decider) {
  if (!decider.context.onBehalf) return;
  throw new DomainError(
    'human_only',
    'Only the human decides this. It waits for them at its gate in Shinsa; tell them it is there.'
  );
}

function assertDecision(gate: Gate, decision: GateDecision, response: string | null) {
  if (gate.secret) {
    assertSecretAnswer(decision, response);
    return;
  }
  const definition = resolveGateDefinition(gate);
  if (!definition.decisions.some((choice) => choice.decision === decision)) {
    throw new DomainError('decision_invalid', definition.refusal);
  }
  if (decision === 'reply' && gate.type !== 'operation' && !response?.trim()) {
    throw new DomainError('answer_required', 'Write an answer first.');
  }
}

function assertCurrentPlan(decider: Decider, gate: Gate, decision: GateDecision, planVersion?: number) {
  if (gate.type !== 'plan' || decision !== 'approve') return;
  const current = decider.task(gate.taskId).plan?.version ?? null;
  if (planVersion === undefined || planVersion === current) return;
  throw new DomainError(
    'plan_changed',
    `The plan changed to version ${current} after you opened it. Read the new version and approve that one.`
  );
}

function assertVerdicts(decider: Decider, gate: Gate, decision: GateDecision, verdicts?: FindingVerdict[]) {
  if (!verdicts || verdicts.length === 0) return;
  if (gate.type !== 'review' && gate.type !== 'merge') {
    throw new DomainError('verdicts_invalid', 'Only review findings take a verdict.');
  }
  const count = decider.task(gate.taskId).findings.length;
  const indexes = verdicts.map((verdict) => verdict.index);
  if (indexes.some((index) => index >= count) || new Set(indexes).size !== indexes.length) {
    throw new DomainError('verdicts_invalid', 'Each verdict must name a different finding of this review.');
  }
  if (decision === 'approve' && verdicts.some((verdict) => verdict.verdict === 'fix')) {
    throw new DomainError(
      'verdicts_conflict',
      'Approving ships the work as it is. Ask for changes to have findings fixed.'
    );
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
  decider.resetRecoveries(gate.taskId);
  acknowledgeBudget(decider, gate);
  retryTask(decider, gate.taskId, decision === 'reply' ? response : null);
}

function approveReview(decider: Decider, taskId: string) {
  clearFixLoop(decider, taskId);
  const reason = decider.task(taskId).pullRequest ? 'pushing the changes' : 'opening the pull request';
  decider.stage(taskId, 'shipping', reason);
  requestPush(decider, taskId);
}

function reviseWork(decider: Decider, gate: Gate, response: string | null) {
  if (gate.type === 'plan') {
    startPlanning(decider, gate.taskId, response ?? 'Revise the plan.');
    return;
  }
  const findings = decider.task(gate.taskId).findings;
  const judged = gate.type === 'review' && findings.some((finding) => finding.verdict);
  const prompt = judged
    ? resolveVerdictFixPrompt(findings, response)
    : resolveHumanFixPrompt(response ?? 'Revise the work.');
  startFix(decider, gate.taskId, 'you', prompt, null);
}

function answerDecision(decider: Decider, gate: Gate, decision: GateDecision, response: string | null) {
  const taskId = gate.taskId;
  if (decision === 'reject') {
    settleTask(decider, taskId, 'cancelled', `${gate.type} rejected`);
    return;
  }
  if (decision === 'revise') {
    reviseWork(decider, gate, response);
    return;
  }
  if (gate.type === 'plan') {
    const version = decider.task(taskId).plan?.version ?? 1;
    decider.emit({ type: 'plan.approved', taskId, version });
    if (response?.trim()) decider.emit({ type: 'plan.answered', taskId, answers: response.trim() });
    startAfterPlan(decider, taskId);
    return;
  }
  if (gate.type === 'review') {
    approveReview(decider, taskId);
    return;
  }
  if (gate.type === 'merge') {
    decider.stage(taskId, 'awaiting_merge', 'merging');
    decider.run({ kind: 'pull_request.merge', taskId });
  }
}

export function answerGate(
  decider: Decider,
  gateId: string,
  decision: GateDecision,
  response: string | null,
  options: AnswerOptions = {}
) {
  const gate = findOpenGate(decider, gateId);
  assertDecision(gate, decision, response);
  assertCurrentPlan(decider, gate, decision, options.planVersion);
  assertVerdicts(decider, gate, decision, options.verdicts);
  assertConfigurationAnswer(decider, gate, decision);
  const verdicts = options.verdicts && options.verdicts.length > 0 ? { verdicts: options.verdicts } : {};
  decider.emit({ type: 'gate.answered', gateId, decision, response, ...verdicts });
  decider.requestBriefing(gate.taskId);
  switch (gate.type) {
    case 'question':
    case 'secret':
      answerQuestion(decider, gate, response);
      return;
    case 'failure':
    case 'sign_in':
      answerFailure(decider, gate, decision, response);
      return;
    case 'configuration':
      answerConfiguration(decider, gate, decision);
      return;
    case 'proposal':
      answerProposal(decider, gate, decision);
      return;
    case 'operation':
      answerOperation(decider, gate, decision, response);
      return;
    case 'plan':
    case 'review':
    case 'merge':
      answerDecision(decider, gate, decision, response);
      return;
  }
}
