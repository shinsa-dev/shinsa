import type { CommandOf } from '../commands/index.ts';
import { DomainError, type RunRole } from '../model/index.ts';
import { serializeSpecMarkdown } from '../report/markdown.ts';
import type { Decider } from './decider.ts';
import { reactToFindings } from './fixes.ts';
import { isLastPhase, needsPlanApproval, resolveCurrentPhase, startChecks, startPhase } from './lifecycle.ts';
import { requestPush } from './pull-requests.ts';
import { findCurrentRun } from './runs.ts';

const ANY_ROLE: readonly RunRole[] = ['planner', 'builder', 'reviewer', 'fixer', 'shipper'];

const FIX_ROLES: readonly RunRole[] = ['fixer', 'shipper'];

export function proposePlan(decider: Decider, command: CommandOf<'agent.propose_plan'>) {
  const { run, task } = findCurrentRun(decider, command.runId, ['planner']);
  const body = serializeSpecMarkdown(command.document);
  decider.emit({ type: 'spec.proposed', taskId: task.id, body, document: command.document });
  decider.endRun(run, 'completed', 'proposed the plan');
  decider.progressed(task.id);
  if (!needsPlanApproval(decider, decider.task(task.id))) {
    startPhase(decider, task.id, 0);
    return;
  }
  decider.stage(task.id, 'awaiting_spec', 'plan ready for you');
  decider.openGate(task.id, 'spec', 'decision', task.title, body);
}

export function completePhase(decider: Decider, command: CommandOf<'agent.complete_phase'>) {
  const { run, task } = findCurrentRun(decider, command.runId, ['builder']);
  const index = run.phaseIndex ?? resolveCurrentPhase(task);
  decider.emit({
    type: 'phase.completed',
    taskId: task.id,
    report: {
      index,
      runId: run.id,
      summary: command.summary,
      spots: command.spots,
      decisions: command.decisions,
      at: decider.context.now,
    },
  });
  if (task.spec?.document?.plan[index]) {
    decider.emit({ type: 'phase.updated', taskId: task.id, index, status: 'done' });
  }
  decider.endRun(run, 'completed', command.summary);
  decider.progressed(task.id);
  if (isLastPhase(decider.task(task.id), index)) {
    startChecks(decider, task.id);
    return;
  }
  startPhase(decider, task.id, index + 1);
}

export function completeFix(decider: Decider, command: CommandOf<'agent.complete_fix'>) {
  const { run, task } = findCurrentRun(decider, command.runId, FIX_ROLES);
  decider.emit({ type: 'task.noted', taskId: task.id, note: command.summary, runId: run.id });
  decider.endRun(run, 'completed', command.summary);
  decider.progressed(task.id);
  if (task.fixFor !== 'pull_request') {
    startChecks(decider, task.id);
    return;
  }
  decider.stage(task.id, 'shipping', 'pushing the fix');
  requestPush(decider, task.id);
}

export function reportReview(decider: Decider, command: CommandOf<'agent.report_review'>) {
  const { run, task } = findCurrentRun(decider, command.runId, ['reviewer']);
  decider.emit({ type: 'review.reported', taskId: task.id, findings: command.findings, runId: run.id });
  decider.endRun(run, 'completed', null);
  decider.progressed(task.id);
  reactToFindings(decider, task.id, command.findings);
}

export function askQuestion(decider: Decider, command: CommandOf<'agent.ask'>) {
  const { run, task } = findCurrentRun(decider, command.runId, ANY_ROLE);
  const existing = decider.state.gates[command.gateId];
  if (existing?.runId === run.id) return;
  if (existing) throw new DomainError('gate_exists', `Gate ${command.gateId} already exists.`);
  decider.openGate(task.id, 'question', 'agent_question', command.question, command.context ?? '', {
    id: command.gateId,
    runId: run.id,
  });
}

export function attachEvidence(decider: Decider, command: CommandOf<'agent.attach_evidence'>) {
  const { run, task } = findCurrentRun(decider, command.runId, ANY_ROLE);
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
    },
  });
}

export function noteProgress(decider: Decider, command: CommandOf<'agent.note'>) {
  const { run, task } = findCurrentRun(decider, command.runId, ANY_ROLE);
  decider.emit({ type: 'task.noted', taskId: task.id, note: command.note, runId: run.id });
}
