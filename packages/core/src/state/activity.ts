import { capitalise, describeList } from '../chat/text.ts';
import { isBlockingCheck } from '../domain/checks.ts';
import { resolveTeammateMachineLabel } from '../domain/duplicates.ts';
import type {
  FixReason,
  GateDecision,
  ReviewEscalation,
  ReviewEscalationReason,
  TaskStage,
  UnreachedTeammate,
} from '../domain/index.ts';
import type { PullRequestWatchChange, PushHookFailure, ShippingStepKind } from '../domain/pull-requests.ts';
import type { EventOf } from '../events/index.ts';
import type { CheckChange, CheckNote, ReportCheck, ReviewFinding } from '../report/types.ts';

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
  conflict: 'resolving conflicts with the base branch',
  update: 'resolving conflicts with the base branch',
  hook: 'fixing what the pre-push hook found',
};

const SHIPPING_STEP_TEXT: Record<ShippingStepKind, string> = {
  updating: 'Updating the branch',
  pushing: 'Pushing',
  opening: 'Opening the pull request',
};

export function describeRetryDelay(retryAt: number, now: number) {
  return `${Math.max(1, Math.round((retryAt - now) / 1000))}s`;
}

export function describePushRetry(event: EventOf<'pull_request.push_retrying'>) {
  return {
    text: `${SHIPPING_STEP_TEXT[event.step]} failed on attempt ${event.attempt} of ${event.attempts}, trying again in ${describeRetryDelay(event.retryAt, event.at)}`,
    detail: event.detail,
  };
}

export function describeHookFailure(failure: PushHookFailure) {
  return {
    text: 'The pre-push hook rejected the push',
    detail: failure.failures && failure.failures.length > 0 ? failure.failures.join('\n') : null,
  };
}

const DECISION_TEXT: Record<GateDecision, string> = {
  approve: 'Approved',
  revise: 'Asked for changes',
  reject: 'Rejected',
  reply: 'Answered',
};

export function describeStage(stage: TaskStage, reason: string, hasPullRequest: boolean) {
  if (stage === 'shipping' && hasPullRequest) return capitalise(reason);
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

export function describeStack(parent: string | null) {
  if (parent === null) return 'Left its bundle';
  return `Stacked on “${parent}” as a bundle`;
}

export function describeChecks(results: ReportCheck[]) {
  const failed = results.filter(isBlockingCheck);
  if (results.length === 1) return failed.length === 0 ? 'The check passed' : 'The check failed';
  if (failed.length === 0) return `All ${results.length} checks passed`;
  return `${failed.length} of ${results.length} checks failed`;
}

const NOTE_TEXT: Record<CheckNote, string> = {
  passed_alone: 'passed when re-run alone',
  fails_on_base: 'already failing on the base branch, so it does not block',
};

export function describeFailedChecks(results: ReportCheck[]) {
  const lines = results.flatMap((check) => {
    if (check.note) return [`${check.label}: ${NOTE_TEXT[check.note]}`];
    return check.outcome === 'fail' ? [`${check.label}: \`${check.command}\` failed`] : [];
  });
  return lines.length === 0 ? null : lines.join('\n');
}

const CHANGE_VERB: Record<CheckChange['action'], string> = {
  add: 'Added the check',
  change: 'Changed the check',
  remove: 'Removed the check',
};

export function describeCheckChange(change: CheckChange) {
  return `${CHANGE_VERB[change.action]} “${change.check.label}”`;
}

export function describeFindings(findings: ReviewFinding[]) {
  if (findings.length === 0) return 'Agent review found nothing';
  const count = (severity: ReviewFinding['severity']) =>
    findings.filter((finding) => finding.severity === severity).length;
  const found = `Agent review found ${findings.length} ${findings.length === 1 ? 'issue' : 'issues'}`;
  const ranked = [
    count('blocking') > 0 ? `${count('blocking')} blocking` : null,
    count('should_fix') > 0 ? `${count('should_fix')} should fix` : null,
  ].filter((part) => part !== null);
  return [found, ...ranked].join(', ');
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

export function describeUnreachedTeammates(unreached: readonly UnreachedTeammate[]) {
  return `Could not check ${describeList(unreached.map(resolveTeammateMachineLabel))} for duplicates`;
}
