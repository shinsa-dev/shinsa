import {
  evaluatePullRequestWatch,
  isSamePullRequest,
  isSamePullRequestWatch,
  type PullRequest,
  type RepoCi,
  resolvePullRequestCi,
  type Task,
} from '@shinsa/core';
import type { PullRequestRead } from '../../../github/index.ts';

export function needsMerge(pullRequest: PullRequest | undefined) {
  return pullRequest?.state !== 'merged' && !pullRequest?.mergeQueue;
}

export function isAwaitingMerge(pullRequest: PullRequest) {
  return pullRequest.state === 'open' && !pullRequest.mergeQueue;
}

export function isHeadMoved(headSha: string | null, pullRequest: PullRequest) {
  return Boolean(headSha && pullRequest.headSha && pullRequest.headSha !== headSha);
}

export function hasPullRequestNews(task: Task, read: PullRequestRead, ci: RepoCi, now: number) {
  if ((task.pullRequestReadFailures ?? 0) > 0) return true;
  if (!isSamePullRequest(task.pullRequest, read.pullRequest)) return true;
  const watch = task.pullRequestWatch;
  if (!watch) return true;
  const report = evaluatePullRequestWatch(
    watch,
    read.pullRequest,
    read.remarks,
    read.viewer,
    resolvePullRequestCi(task, watch, ci, now)
  );
  return report.changes.length > 0 || !isSamePullRequestWatch(report.next, watch);
}
