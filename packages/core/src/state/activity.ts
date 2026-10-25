import type {
  FixReason,
  GateDecision,
  ReviewEscalation,
  ReviewEscalationReason,
  TaskStage,
} from '../domain/index.ts';
import type { PullRequestWatchChange } from '../domain/pull-requests.ts';
import type { ReportCheck, ReviewFinding } from '../report/types.ts';

const STAGE_ACTIVITY: Partial<Record<TaskStage, string>> = {
  waiting_on_tasks: 'Waiting on another task',
  planning: 'Planning started',
  building: 'Building started',
  checking: 'Running the checks',
  reviewing: 'Agent review started',
  awaiting_review: 'Changes ready for your review',
  shipping: 'Opening the pull request',
  awaiting_merge: 'Ready to merge',
  answering: 'Answering the question',
  investigating: 'Investigation started',
  researching: 'Research started',
  operating: 'Running the operation',
  awaiting_operation: 'Merged, ready to run the operation',
  merged: 'Merged',
  done: 'Marked done',
  cancelled: 'Cancelled',
};

const FIX_REASON_TEXT: Record<Exclude<FixReason, 'you'>, string> = {
  checks: 'fixing failing checks',
  review: 'fixing what the agent review found',
  pull_request: 'fixing the pull request',
  conflict: 'resolving the conflicts GitButler left',
};

const DECISION_TEXT: Record<GateDecision, string> = {
  approve: 'Approved',
  revise: 'Asked for changes',
  reject: 'Rejected',
  reply: 'Answered',
  waive: 'Started without checks',
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

const ESCALATION_TEXT: Record<ReviewEscalationReason, (rounds: string) => string> = {
  rounds: (rounds) => `the reviewer still had blocking findings after ${rounds}`,
  stalled: () => 'the same findings came back on unchanged code',
  exhausted: (rounds) => `${rounds} used up the automatic budget`,
};

export function describeEscalation(escalation: ReviewEscalation) {
  const rounds = `${escalation.rounds} fix ${escalation.rounds === 1 ? 'round' : 'rounds'}`;
  return `Sent the review to you: ${ESCALATION_TEXT[escalation.reason](rounds)}`;
}

export function describeSuggestionSettled(status: 'accepted' | 'dismissed', title: string) {
  return status === 'accepted'
    ? `Added the suggested task “${title}”`
    : `Dismissed the suggested task “${title}”`;
}

function describePullRequestChange(change: PullRequestWatchChange) {
  switch (change.kind) {
    case 'checks_failed':
      return `Checks failed on GitHub: ${change.failed.map((check) => `\`${check.name}\``).join(', ')}`;
    case 'checks_passed':
      return `All ${change.count} ${change.required ? 'required ' : ''}${change.count === 1 ? 'check' : 'checks'} passed on GitHub`;
    case 'remarks':
      return `${change.total ?? change.remarks.length} new ${(change.total ?? change.remarks.length) === 1 ? 'comment' : 'comments'} on the pull request`;
    case 'conflicting':
      return 'The branch now conflicts with its base';
  }
}

export function describePullRequestChanges(changes: PullRequestWatchChange[]) {
  return changes.map(describePullRequestChange).join('. ');
}

export function describePullRequestRemarks(changes: PullRequestWatchChange[]) {
  const lines = changes.flatMap((change) =>
    change.kind === 'remarks'
      ? change.remarks.map((remark) => {
          const where = remark.path ? ` on ${remark.path}` : '';
          return `${remark.author ?? 'someone'}${where}: ${remark.body || (remark.reviewState ?? 'reviewed')}`;
        })
      : []
  );
  return lines.length > 0 ? lines.join('\n') : null;
}
