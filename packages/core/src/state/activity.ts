import type { FixReason, GateDecision, TaskStage } from '../model/index.ts';
import type { ReportCheck, ReviewFinding } from '../report/types.ts';

const STAGE_ACTIVITY: Partial<Record<TaskStage, string>> = {
  queued: 'Waiting on another task',
  planning: 'Planning started',
  building: 'Building started',
  checking: 'Running the checks',
  reviewing: 'Agent review started',
  awaiting_review: 'Changes ready for your review',
  shipping: 'Opening the pull request',
  awaiting_merge: 'Ready to merge',
  merged: 'Merged',
  done: 'Marked done',
  cancelled: 'Cancelled',
};

const FIX_REASON_TEXT: Record<Exclude<FixReason, 'you'>, string> = {
  checks: 'fixing failing checks',
  review: 'fixing what the agent review found',
  pull_request: 'fixing the pull request',
};

const DECISION_TEXT: Record<GateDecision, string> = {
  approve: 'Approved',
  revise: 'Asked for changes',
  reject: 'Rejected',
  answer: 'Answered',
};

export function describeStage(stage: TaskStage) {
  return STAGE_ACTIVITY[stage] ?? null;
}

export function describeFixRound(round: number, reason: FixReason) {
  if (reason === 'you') return 'Making the changes you asked for';
  return `Fix round ${round}: ${FIX_REASON_TEXT[reason]}`;
}

export function describeDecision(decision: GateDecision, title: string) {
  return `${DECISION_TEXT[decision]}: ${title}`;
}

export function describeDependencies(titles: string[]) {
  if (titles.length === 0) return 'Stopped waiting on other tasks';
  return `Waits on ${titles.map((title) => `“${title}”`).join(', ')}`;
}

export function describeChecks(results: ReportCheck[]) {
  const failed = results.filter((check) => check.outcome === 'fail');
  if (results.length === 0) return 'No checks are set up for this repository';
  if (results.length === 1) return failed.length === 0 ? 'The check passed' : 'The check failed';
  if (failed.length === 0) return `All ${results.length} checks passed`;
  return `${failed.length} of ${results.length} checks failed`;
}

export function describeFailedChecks(results: ReportCheck[]) {
  const failed = results.filter((check) => check.outcome === 'fail');
  if (failed.length === 0) return null;
  return failed.map((check) => `\`${check.name}\``).join(', ');
}

export function describeFindings(findings: ReviewFinding[]) {
  if (findings.length === 0) return 'Agent review found nothing';
  const blocking = findings.filter((finding) => finding.severity === 'blocking').length;
  const found = `Agent review found ${findings.length} ${findings.length === 1 ? 'issue' : 'issues'}`;
  return blocking > 0 ? `${found}, ${blocking} blocking` : found;
}
