import { isTaskSettled, type Run, type Task } from '../model/index.ts';
import { resolvePhasePrompt, resolvePlannerPrompt, resolveReviewerPrompt } from '../prompts/index.ts';
import { assembleReport } from '../report/assemble.ts';
import { serializeReportMarkdown } from '../report/markdown.ts';
import { listPendingDependencies } from '../state/queries.ts';
import { type Decider, quoteTitles } from './decider.ts';

export type SettledStage = 'merged' | 'done' | 'cancelled';

function countPhases(task: Task) {
  return Math.max(1, task.spec?.document?.plan.length ?? 0);
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
    decider.stage(taskId, 'queued', `waiting for ${quoteTitles(pending)} to finish`);
    return;
  }
  decider.stage(taskId, 'triage', 'setting up the worktree');
  decider.run({ kind: 'worktree.create', taskId });
}

export function startPlanning(decider: Decider, taskId: string, feedback: string | null) {
  decider.stage(taskId, 'planning', feedback ? 'revising the plan' : 'planning the phases');
  const task = decider.task(taskId);
  decider.startRun(
    task,
    'planner',
    resolvePlannerPrompt(task, decider.repoOf(task), decider.basesOf(task), feedback),
    { resumeFrom: feedback ? decider.lastRun(taskId, ['planner']) : null }
  );
}

export function needsPlanApproval(decider: Decider, task: Task) {
  if (!decider.state.settings.approvePlans) return false;
  return task.size === 'large' || task.specFirst || (task.spec?.version ?? 0) > 1;
}

export function startPhase(
  decider: Decider,
  taskId: string,
  index: number,
  resumeFrom: Run | null = null,
  addition = ''
) {
  const plan = decider.task(taskId).spec?.document?.plan ?? [];
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
  decider.startRun(task, 'builder', prompt, { phaseIndex: index, resumeFrom });
}

export function startChecks(decider: Decider, taskId: string) {
  decider.cancelRuns(taskId);
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

export function openReviewGate(decider: Decider, taskId: string) {
  const report = assembleReport(decider.task(taskId));
  decider.emit({ type: 'work.submitted', taskId, summary: report.headline, report });
  decider.stage(taskId, 'awaiting_review', 'changes ready for your review');
  decider.openGate(taskId, 'review', 'decision', decider.task(taskId).title, serializeReportMarkdown(report));
}

export function settleTask(decider: Decider, taskId: string, stage: SettledStage, reason: string) {
  const task = decider.task(taskId);
  if (isTaskSettled(task)) return;
  decider.cancelRuns(taskId);
  decider.withdrawGates(taskId, () => true);
  decider.stage(taskId, stage, reason);
  if (task.worktreePath) decider.run({ kind: 'worktree.remove', taskId });
  decider.requestBriefing(taskId);
  for (const dependent of Object.values(decider.state.tasks)) {
    if (!dependent.blockedBy.includes(taskId)) continue;
    if (dependent.stage === 'shipping' || dependent.stage === 'awaiting_merge') {
      decider.run({ kind: 'pull_request.watch', taskId: dependent.id });
    }
  }
}
