import {
  hasStep,
  isTaskSettled,
  PLAN_GATE_RULE,
  type PlanGateReason,
  type ReviewEscalation,
  type Run,
  type Task,
} from '../domain/index.ts';
import type { ShinsaEffectKind } from '../effects/index.ts';
import { resolvePhasePrompt, resolvePlannerPrompt, resolveReviewerPrompt } from '../prompts/index.ts';
import { assembleReport } from '../report/assemble.ts';
import { serializeReportMarkdown } from '../report/markdown.ts';
import { listPendingDependencies } from '../state/queries.ts';
import { type Decider, quoteTitles } from './decider.ts';

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

export function startWork(decider: Decider, taskId: string) {
  const pending = listPendingDependencies(decider.state, decider.task(taskId));
  if (pending.length > 0) {
    decider.cancelRuns(taskId);
    decider.clearWaits(taskId);
    decider.stage(taskId, 'waiting_on_tasks', `waiting for ${quoteTitles(pending)} to finish`);
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
    'planner',
    resolvePlannerPrompt(task, decider.repoOf(task), decider.basesOf(task), feedback),
    {
      resumeFrom: feedback ? decider.lastRun(taskId, ['planner']) : decider.resumeRound(task, ['planner']),
      feedback,
    }
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

export function startPhase(
  decider: Decider,
  taskId: string,
  index: number,
  resumeFrom: Run | null = null,
  addition = ''
) {
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
  const prompt = resolvePhasePrompt(task, decider.repoOf(task), decider.basesOf(task), index) + addition;
  const opening = index === 0 && task.phaseReports.length === 0;
  decider.startRun(task, 'builder', prompt, {
    phaseIndex: index,
    resumeFrom: resumeFrom ?? (opening ? decider.resumeRound(task, ['builder', 'fixer']) : null),
  });
}

export function startChecks(decider: Decider, taskId: string) {
  decider.cancelRuns(taskId);
  decider.cancelEffects(taskId, ['checks.run'], 'A new round of checks replaced it.');
  decider.stage(taskId, 'checking', 'running the checks');
  decider.run({ kind: 'checks.run', taskId, round: decider.task(taskId).fixRounds });
}

export function startReview(decider: Decider, taskId: string) {
  decider.stage(taskId, 'reviewing', 'agent review');
  const task = decider.task(taskId);
  decider.startRun(
    task,
    'reviewer',
    resolveReviewerPrompt(task, decider.repoOf(task), decider.basesOf(task))
  );
}

export function openReviewGate(decider: Decider, taskId: string, escalation: ReviewEscalation | null = null) {
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
  decider.requestBriefing(taskId);
  for (const dependent of Object.values(decider.state.tasks)) {
    if (!dependent.waitsOn.includes(taskId)) continue;
    if (dependent.stage === 'shipping' || dependent.stage === 'awaiting_merge') {
      decider.run({ kind: 'pull_request.watch', taskId: dependent.id });
    }
  }
}
