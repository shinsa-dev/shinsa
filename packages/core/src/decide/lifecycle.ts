import {
  hasStep,
  isOfCurrentRound,
  isTaskSettled,
  needsRepository,
  PLAN_GATE_RULE,
  type PlanGateReason,
  type ReviewEscalation,
  resolveTaskPipeline,
  type Task,
} from '../domain/index.ts';
import type { ShinsaEffectKind } from '../effects/index.ts';
import {
  resolveAgentPrompt,
  resolvePhaseInstruction,
  resolvePlanningPrompt,
  resolveReviewerPrompt,
} from '../prompts/index.ts';
import { assembleReport } from '../report/assemble.ts';
import { serializeReportMarkdown } from '../report/markdown.ts';
import { listPendingDependencies } from '../state/queries.ts';
import { startHeldConflictFix } from './conflicts.ts';
import { type Decider, quoteTitles } from './decider.ts';
import { unstackTasksOn } from './dependencies.ts';
import { proceedAfterSetup } from './shapes.ts';
import { holdForCheckout } from './workspaces.ts';

type SettledStage = 'merged' | 'done' | 'cancelled';

export const VERIFYING_SETUP = 'verifying the setup';

const SETTLED_EFFECTS: ShinsaEffectKind[] = [
  'task.triage',
  'config.verify',
  'worktree.create',
  'checks.run',
  'pull_request.open',
  'pull_request.push',
  'pull_request.watch',
  'workspace.update',
];

function countPhases(task: Task) {
  return Math.max(1, task.plan?.document?.phases.length ?? 0);
}

export function resolveCurrentPhase(task: Task) {
  const total = countPhases(task);
  for (let index = 0; index < total; index += 1) {
    if (!task.phaseReports.some((report) => report.index === index)) return index;
  }
  return total - 1;
}

export function isLastPhase(task: Task, index: number) {
  return index + 1 >= countPhases(task);
}

function needsSetup(task: Task) {
  return task.repoId !== null || needsRepository(resolveTaskPipeline(task));
}

export function startWork(decider: Decider, taskId: string) {
  const pending = listPendingDependencies(decider.state, decider.task(taskId));
  if (pending.length > 0) {
    decider.cancelRuns(taskId);
    decider.clearWaits(taskId);
    decider.stage(taskId, 'waiting_on_tasks', `waiting for ${quoteTitles(pending)} to finish`);
    return;
  }
  if (holdForCheckout(decider, taskId)) return;
  if (!needsSetup(decider.task(taskId))) {
    proceedAfterSetup(decider, taskId);
    return;
  }
  decider.stage(taskId, 'triage', VERIFYING_SETUP);
  decider.run({ kind: 'config.verify', taskId });
}

export function startPlanning(decider: Decider, taskId: string, feedback: string | null) {
  decider.stage(taskId, 'planning', feedback ? 'revising the plan' : 'planning the phases');
  const task = decider.task(taskId);
  decider.startRun(
    task,
    'agent',
    resolvePlanningPrompt(task, decider.repoOf(task), decider.basesOf(task), feedback),
    { purpose: 'plan', resumeFrom: decider.taskSession(taskId, 'agent'), feedback }
  );
}

const PLAN_GATE_TEST: Record<PlanGateReason, (task: Task) => boolean> = {
  operates: (task) => hasStep(task, 'operate'),
  plan_first: (task) => task.planFirst,
  asks_approval: (task) => task.plan?.document?.approval === true,
  large: (task) => task.size === 'large',
  revised: (task) => (task.plan?.version ?? 0) > 1,
};

export function needsPlanApproval(decider: Decider, task: Task) {
  const passes = (reason: PlanGateReason) => PLAN_GATE_TEST[reason](task);
  if (PLAN_GATE_RULE.always.some(passes)) return true;
  return decider.state.settings.approvePlans === true && PLAN_GATE_RULE.withApprovePlans.some(passes);
}

export function startPhase(decider: Decider, taskId: string, index: number, addition = '') {
  const plan = decider.task(taskId).plan?.document?.phases ?? [];
  const step = plan[index];
  decider.stage(
    taskId,
    'building',
    step ? `phase ${index + 1} of ${plan.length}: ${step.title}` : 'building'
  );
  if (step && decider.task(taskId).phases[index]?.status !== 'active') {
    decider.emit({ type: 'phase.updated', taskId, index, status: 'active' });
  }
  const task = decider.task(taskId);
  const instruction = resolvePhaseInstruction(task, decider.repoOf(task), index) + addition;
  decider.startRun(task, 'agent', resolveAgentPrompt(instruction), {
    purpose: 'build',
    phaseIndex: index,
    resumeFrom: decider.taskSession(taskId, 'agent'),
  });
}

export function startChecks(decider: Decider, taskId: string, reason = 'running the checks') {
  decider.cancelRuns(taskId);
  decider.cancelEffects(taskId, ['checks.run'], 'A new round of checks replaced it.');
  decider.stage(taskId, 'checking', reason);
  decider.run({ kind: 'checks.run', taskId, round: decider.task(taskId).fixRounds });
}

export function startReview(decider: Decider, taskId: string) {
  decider.stage(taskId, 'reviewing', 'agent review');
  const task = decider.task(taskId);
  const resumeFrom = decider.taskSession(taskId, 'reviewer');
  decider.startRun(
    task,
    'reviewer',
    resolveReviewerPrompt(
      task,
      decider.repoOf(task),
      decider.basesOf(task),
      resumeFrom !== null,
      Object.values(decider.state.evidence).filter(
        (item) => item.taskId === taskId && item.runId !== null && isOfCurrentRound(task, item)
      )
    ),
    { resumeFrom }
  );
}

export function openReviewGate(decider: Decider, taskId: string, escalation: ReviewEscalation | null = null) {
  if (startHeldConflictFix(decider, taskId)) return;
  const report = assembleReport(decider.task(taskId));
  decider.emit({ type: 'work.submitted', taskId, summary: report.headline, report });
  decider.stage(
    taskId,
    'awaiting_review',
    escalation ? 'the agents could not settle the review' : 'changes ready for your review'
  );
  decider.openGate(taskId, 'review', decider.task(taskId).title, serializeReportMarkdown(report), {
    ...(escalation ? { details: { escalation } } : {}),
  });
}

export function settleTask(
  decider: Decider,
  taskId: string,
  stage: SettledStage,
  reason: string,
  by: 'you' | null = null
) {
  const task = decider.task(taskId);
  if (isTaskSettled(task)) return;
  decider.cancelRuns(taskId);
  decider.cancelEffects(
    taskId,
    stage === 'merged' ? SETTLED_EFFECTS : [...SETTLED_EFFECTS, 'pull_request.merge'],
    'The task is finished.'
  );
  decider.withdrawGates(taskId, () => true);
  decider.clearWaits(taskId);
  decider.stage(taskId, stage, reason, by);
  if (task.worktreePath) decider.run({ kind: 'worktree.remove', taskId });
  decider.run({ kind: 'scratch.remove', taskId });
  decider.requestBriefing(taskId);
  if (task.pullRequest?.state !== 'merged') unstackTasksOn(decider, taskId);
  for (const dependent of Object.values(decider.state.tasks)) {
    if (!dependent.waitsOn.includes(taskId)) continue;
    if (dependent.stage === 'shipping' || dependent.stage === 'awaiting_merge') {
      decider.run({ kind: 'pull_request.watch', taskId: dependent.id });
    }
  }
}
