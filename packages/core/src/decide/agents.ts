import type { CommandOf } from '../commands/index.ts';
import {
  DomainError,
  isOfCurrentRound,
  listMissingEvidence,
  type PlanEvidenceKind,
  resolveRoundStamp,
  resolveTaskPipeline,
  type Task,
  validatePlanRules,
} from '../domain/index.ts';
import { assembleReport } from '../report/assemble.ts';
import { serializePlanMarkdown } from '../report/markdown.ts';
import type { PlanDocument } from '../report/types.ts';
import {
  assertCheckIds,
  findTaskCheck,
  recordCheckChanges,
  resolveCheckChanges,
  startFixChecks,
  startPhaseChecks,
} from './checks.ts';
import type { Decider } from './decider.ts';
import { reactToFindings } from './fixes.ts';
import { isLastPhase, needsPlanApproval, resolveCurrentPhase } from './lifecycle.ts';
import { requestPush } from './pull-requests.ts';
import { findCurrentRun } from './runs.ts';
import { startAfterPlan } from './shapes.ts';

function recordTree(decider: Decider, taskId: string, treeHash: string | null | undefined) {
  if (!treeHash || decider.task(taskId).treeHash === treeHash) return;
  decider.emit({ type: 'work.committed', taskId, treeHash });
}

function assertPlanRules(task: Task, document: PlanDocument) {
  const errors = validatePlanRules(resolveTaskPipeline(task), document);
  if (errors.length > 0) throw new DomainError('plan_invalid', errors.join(' '));
}

const EVIDENCE_NOUN: Record<PlanEvidenceKind, string> = {
  screenshot: 'a screenshot',
  recording: 'a recording',
  test: 'a test run, linked to its check',
  note: 'a note',
  preview: 'a preview link',
};

export function assertEvidence(decider: Decider, task: Task, handOver: string) {
  const attached = Object.values(decider.state.evidence).filter(
    (evidence) => evidence.taskId === task.id && isOfCurrentRound(task, evidence)
  );
  const missing = listMissingEvidence(task.plan?.document ?? null, attached);
  if (missing.length === 0) return;
  const kinds = missing.map((kind) => `${EVIDENCE_NOUN[kind]} (\`${kind}\`)`).join(' and ');
  throw new DomainError(
    'evidence_missing',
    `The plan asks for ${kinds} as evidence. Attach it with \`attach_evidence\` before you ${handOver}.`
  );
}

export function proposePlan(decider: Decider, command: CommandOf<'agent.propose_plan'>) {
  const { run, task } = findCurrentRun(decider, command.runId, 'propose_plan');
  assertPlanRules(task, command.document);
  const changeSummary = command.changeSummary?.trim() || null;
  const body = serializePlanMarkdown(command.document);
  decider.emit({
    type: 'plan.proposed',
    taskId: task.id,
    body,
    document: command.document,
    ...(task.plan ? { changeSummary, feedback: run.feedback ?? null } : {}),
  });
  decider.endRun(run, 'completed', 'proposed the plan');
  decider.progressed(task.id);
  const proposed = decider.task(task.id);
  if (!needsPlanApproval(decider, proposed)) {
    startAfterPlan(decider, task.id);
    return;
  }
  decider.stage(task.id, 'awaiting_plan', 'plan ready for you');
  decider.openGate(task.id, 'plan', task.title, body, {
    details: { planVersion: proposed.plan?.version ?? 1 },
  });
}

export function completePhase(decider: Decider, command: CommandOf<'agent.complete_phase'>) {
  const { run, task } = findCurrentRun(decider, command.runId, 'complete_phase');
  const index = run.phaseIndex ?? resolveCurrentPhase(task);
  if (isLastPhase(task, index)) assertEvidence(decider, task, 'complete the last phase');
  const changes = resolveCheckChanges(decider, task, command.checkChanges ?? [], index + 1);
  recordTree(decider, task.id, command.treeHash);
  decider.emit({
    type: 'phase.completed',
    taskId: task.id,
    report: {
      index,
      runId: run.id,
      summary: command.summary,
      spots: command.spots,
      judgementCalls: command.judgementCalls,
      ...(command.walkthrough ? { walkthrough: command.walkthrough } : {}),
      ...(command.files && command.files.length > 0 ? { files: command.files } : {}),
      at: decider.context.now,
    },
  });
  if (task.plan?.document?.phases[index]) {
    decider.emit({ type: 'phase.updated', taskId: task.id, index, status: 'done' });
  }
  const changed = recordCheckChanges(decider, task.id, run.id, changes);
  decider.endRun(run, 'completed', command.summary);
  decider.progressed(task.id);
  startPhaseChecks(decider, task.id, index + 1, changed);
}

function isPushedFix(task: Task) {
  if (task.fixFor === 'pull_request') return true;
  return task.fixFor === 'conflict' && (task.pullRequest !== null || task.pushPending === true);
}

export function completeFix(decider: Decider, command: CommandOf<'agent.complete_fix'>) {
  const { run, task } = findCurrentRun(decider, command.runId, 'complete_fix');
  const named = command.checks ?? [];
  assertCheckIds(decider, task, named);
  const done = new Set(task.phaseReports.map((report) => report.index)).size;
  const changes = resolveCheckChanges(decider, task, command.checkChanges ?? [], done);
  recordTree(decider, task.id, command.treeHash);
  decider.emit({ type: 'task.noted', taskId: task.id, note: command.summary, runId: run.id });
  if (command.walkthrough) {
    decider.emit({
      type: 'walkthrough.revised',
      taskId: task.id,
      walkthrough: command.walkthrough,
      runId: run.id,
    });
  }
  const changed = recordCheckChanges(decider, task.id, run.id, changes);
  decider.endRun(run, 'completed', command.summary);
  decider.progressed(task.id);
  if (!isPushedFix(task)) {
    startFixChecks(decider, task.id, [...named, ...changed], command.files ?? []);
    return;
  }
  decider.stage(task.id, 'shipping', 'pushing the fix');
  requestPush(decider, task.id);
}

function resolveDisagreements(task: Task, disagreements: { call: number; reason: string }[]) {
  const calls = assembleReport(task).judgementCalls;
  return disagreements.map(({ call: number, reason }) => {
    const call = calls[number - 1];
    if (!call) {
      throw new DomainError(
        'unknown_judgement_call',
        `disagreements names judgement call ${number}, but the agent made ${calls.length}. Use the numbers from your brief.`
      );
    }
    return { call: call.call, reason };
  });
}

export function reportReview(decider: Decider, command: CommandOf<'agent.report_review'>) {
  const { run, task } = findCurrentRun(decider, command.runId, 'report_review');
  const disagreements = resolveDisagreements(task, command.disagreements ?? []);
  decider.emit({
    type: 'review.reported',
    taskId: task.id,
    summary: command.summary,
    findings: command.findings,
    ...(disagreements.length > 0 ? { disagreements } : {}),
    runId: run.id,
  });
  decider.endRun(run, 'completed', null);
  decider.progressed(task.id);
  reactToFindings(decider, task.id, command.findings);
}

export function askQuestion(decider: Decider, command: CommandOf<'agent.ask'>) {
  const { run, task } = findCurrentRun(decider, command.runId, 'ask');
  const existing = decider.state.gates[command.gateId];
  if (existing?.runId === run.id) return;
  if (existing) throw new DomainError('gate_exists', `Gate ${command.gateId} already exists.`);
  const choices = command.choices ?? [];
  decider.openGate(task.id, 'question', command.question, command.context ?? '', {
    id: command.gateId,
    runId: run.id,
    ...(choices.length > 0 ? { details: { choices, recommendation: command.recommendation ?? null } } : {}),
  });
}

export function attachEvidence(decider: Decider, command: CommandOf<'agent.attach_evidence'>) {
  const { run, task } = findCurrentRun(decider, command.runId, 'attach_evidence');
  decider.emit({
    type: 'evidence.attached',
    evidence: {
      id: decider.context.newId(),
      taskId: task.id,
      runId: run.id,
      kind: command.kind,
      title: command.title,
      uri: command.uri,
      attachedAt: decider.context.now,
      ...resolveRoundStamp(task),
      ...(command.detail ? { detail: command.detail } : {}),
      ...(command.width ? { width: command.width } : {}),
      ...(command.theme ? { theme: command.theme } : {}),
      ...(command.stage ? { stage: command.stage } : {}),
    },
  });
}

export function attachCheck(decider: Decider, command: CommandOf<'agent.attach_check'>) {
  const { run, task } = findCurrentRun(decider, command.runId, 'attach_evidence');
  const check = findTaskCheck(decider, task, command.checkId);
  decider.emit({
    type: 'evidence.attached',
    evidence: {
      id: decider.context.newId(),
      taskId: task.id,
      runId: run.id,
      kind: command.kind,
      title: check.label,
      uri: `shinsa://check/${command.checkId}`,
      attachedAt: decider.context.now,
      checkId: command.checkId,
      ...resolveRoundStamp(task),
      ...(command.detail ? { detail: command.detail } : {}),
    },
  });
}

export function attachComparison(decider: Decider, command: CommandOf<'agent.attach_comparison'>) {
  const { run, task } = findCurrentRun(decider, command.runId, 'attach_evidence');
  const itemId = decider.context.newId();
  for (const part of command.parts) {
    decider.emit({
      type: 'evidence.attached',
      evidence: {
        id: decider.context.newId(),
        taskId: task.id,
        runId: run.id,
        kind: part.kind,
        title: command.title,
        uri: part.uri,
        attachedAt: decider.context.now,
        itemId,
        ...resolveRoundStamp(task),
        ...(command.detail ? { detail: command.detail } : {}),
        ...(command.width ? { width: command.width } : {}),
        ...(command.theme ? { theme: command.theme } : {}),
        ...(part.stage ? { stage: part.stage } : {}),
        ...(part.label ? { label: part.label } : {}),
      },
    });
  }
}

export function noteProgress(decider: Decider, command: CommandOf<'agent.note'>) {
  const { run, task } = findCurrentRun(decider, command.runId, 'note');
  decider.emit({ type: 'task.noted', taskId: task.id, note: command.note, runId: run.id });
}
