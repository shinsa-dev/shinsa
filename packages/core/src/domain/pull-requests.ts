export type PullRequestCheckStatus =
  | 'pending'
  | 'success'
  | 'failure'
  | 'cancelled'
  | 'action_required'
  | 'skipped'
  | 'neutral';

export interface CiRun {
  name: string;
  status: PullRequestCheckStatus;
  required: boolean | null;
  url: string | null;
}

export interface PullRequestRemark {
  id: string;
  author: string | null;
  createdAt: string;
  editedAt: string | null;
  body: string;
  path: string | null;
  url: string | null;
  reviewState: string | null;
}

export type MergeQueueState =
  | 'queued'
  | 'awaiting_checks'
  | 'mergeable'
  | 'unmergeable'
  | 'locked'
  | 'auto_merge';

export interface MergeQueueEntry {
  state: MergeQueueState;
  position: number | null;
}

export type PullRequestWatchStop = 'comment_limit' | 'unreadable';

export interface PullRequestWatch {
  startedAt: number;
  headSha: string | null;
  failedChecks: string[];
  passed: boolean;
  passedChecks: string[];
  remarksThrough: string;
  remarkIds: string[];
  conflicting: boolean;
  wakes: number;
  stopped: PullRequestWatchStop | null;
  ciAbsent: boolean;
}

export type RepoCi = 'none' | 'workflows' | 'required' | 'unknown';

export interface PullRequestCi {
  repo: RepoCi;
  since: number;
  now: number;
}

export type PullRequestWatchChange =
  | { kind: 'checks_failed'; failed: CiRun[]; total?: number }
  | { kind: 'checks_passed'; count: number; required: boolean }
  | { kind: 'remarks'; remarks: PullRequestRemark[]; total?: number }
  | { kind: 'conflicting' };

export type ShippingStep =
  | { kind: 'updating'; base: string }
  | { kind: 'pushing'; hook: boolean }
  | { kind: 'opening' };

export type ShippingStepKind = ShippingStep['kind'];

export interface PullRequestCloseFailure {
  number: number;
  detail: string;
}

export interface PushHookFailure {
  output: string;
  failures: string[] | null;
  signature: string;
}
