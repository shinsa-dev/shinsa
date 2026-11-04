import { type AutoShipRisk, resolveAutoShipPolicy, type Settings } from '../domain/settings.ts';
import type { Task } from '../domain/types.ts';
import type { ReviewFinding, ReviewRating } from '../report/types.ts';

export type AutoShipDecision = { approve: true; reason: string } | { approve: false; reason: string };

const RISK_ORDER: Record<ReviewRating, number> = { low: 0, medium: 1, high: 2 };

function isRiskWithin(risk: ReviewRating, upTo: AutoShipRisk) {
  return upTo !== 'none' && RISK_ORDER[risk] <= RISK_ORDER[upTo];
}

function isUrgent(task: Task) {
  return task.priority === 'urgent';
}

function isRiskAllowed(settings: Settings, task: Task, risk: ReviewRating) {
  const policy = resolveAutoShipPolicy(settings);
  if (isRiskWithin(risk, policy.approveUpTo)) return true;
  return isUrgent(task) && isRiskWithin(risk, policy.urgentApproveUpTo);
}

export function isAutoShipCandidate(settings: Settings, task: Task) {
  const ratings = task.reviewRatings;
  if (!resolveAutoShipPolicy(settings).enabled || !ratings) return false;
  return ratings.confidence === 'high' && isRiskAllowed(settings, task, ratings.risk);
}

function isDismissed(task: Task, finding: ReviewFinding) {
  return (task.dismissedFindings ?? []).some(
    (dismissed) =>
      dismissed.file === finding.file &&
      dismissed.line === finding.line &&
      dismissed.message === finding.message
  );
}

export function isFindingFixedBeforeReview(settings: Settings, task: Task, finding: ReviewFinding) {
  if (isDismissed(task, finding)) return false;
  if (finding.severity === 'blocking') return true;
  if (finding.severity !== 'should_fix') return false;
  return task.approveAfterFix === true || isAutoShipCandidate(settings, task);
}

function describeApproval(task: Task, risk: ReviewRating) {
  return isUrgent(task) ? `High confidence, ${risk} risk, urgent.` : `High confidence, ${risk} risk.`;
}

export function resolveAutoShipDecision(
  settings: Settings,
  task: Task,
  escalated: boolean
): AutoShipDecision | null {
  const ratings = task.reviewRatings;
  if (!resolveAutoShipPolicy(settings).enabled) return null;
  if (escalated) return { approve: false, reason: 'The agents could not settle the review.' };
  if (!ratings) return { approve: false, reason: 'The reviewer did not rate the change.' };
  if (ratings.confidence !== 'high') {
    return { approve: false, reason: `The reviewer’s confidence is ${ratings.confidence}.` };
  }
  if (!isRiskAllowed(settings, task, ratings.risk)) {
    return { approve: false, reason: `The risk is ${ratings.risk}, above what Auto-ship approves.` };
  }
  return { approve: true, reason: describeApproval(task, ratings.risk) };
}
