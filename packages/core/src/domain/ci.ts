import type { CiRun } from './pull-requests.ts';
import type { PullRequest } from './types.ts';

export function isFailedCiRun(check: CiRun) {
  return check.status === 'failure' || check.status === 'cancelled' || check.status === 'action_required';
}

export function isInheritedCiFailure(check: CiRun) {
  return isFailedCiRun(check) && check.failsOnBase === true;
}

export function isBlockingCiFailure(check: CiRun) {
  return isFailedCiRun(check) && check.failsOnBase !== true;
}

export function listInheritedCiFailures(pullRequest: PullRequest) {
  return (pullRequest.checkRuns ?? []).filter(isInheritedCiFailure);
}

export function hasBlockingCiFailure(pullRequest: PullRequest) {
  if (pullRequest.checks !== 'failing') return false;
  if (!pullRequest.checkRuns) return true;
  return pullRequest.checkRuns.some(isBlockingCiFailure);
}
