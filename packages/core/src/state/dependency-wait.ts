import { hasMergedPullRequest } from '../domain/stages.ts';
import type { PullRequest, Task, TaskStage } from '../domain/types.ts';

const STAGE_WAIT: Record<TaskStage, string> = {
  triage: 'has not started',
  waiting_on_tasks: 'is waiting on other tasks',
  planning: 'is being planned',
  awaiting_plan: 'waits for its plan to be approved',
  building: 'is being built',
  checking: 'is running its checks',
  reviewing: 'is in agent review',
  fixing: 'is being fixed',
  awaiting_review: 'waits for your review',
  shipping: 'is opening its pull request',
  awaiting_merge: 'is ready to merge',
  answering: 'is answering a follow-up',
  investigating: 'is being investigated',
  researching: 'is being researched',
  operating: 'is running an operation',
  watching: 'is checking a watchdog',
  leading: 'is following its tasks',
  awaiting_proposal: 'waits for your OK',
  awaiting_operation: 'waits for your OK on its operation',
  answered: 'is answered',
  merged: 'has merged',
  done: 'is done',
  cancelled: 'was cancelled',
};

function describePullRequestWait(pullRequest: PullRequest, stage: TaskStage) {
  const name = `pull request #${pullRequest.number}`;
  if (stage === 'awaiting_merge') {
    return pullRequest.mergeQueue ? `has ${name} in the merge queue` : `has ${name} ready to merge`;
  }
  if (pullRequest.mergeable === false) return `has a conflict on ${name}`;
  if (pullRequest.checks === 'failing') return `has failing checks on ${name}`;
  if (pullRequest.checks === 'pending') return `has ${name} waiting for CI`;
  return `has ${name} open`;
}

export function describeDependencyWait(task: Task) {
  if (task.stage === 'cancelled') return STAGE_WAIT.cancelled;
  if (hasMergedPullRequest(task)) return STAGE_WAIT.merged;
  const pullRequest = task.pullRequest;
  if (pullRequest?.state === 'open' && (task.stage === 'shipping' || task.stage === 'awaiting_merge')) {
    return describePullRequestWait(pullRequest, task.stage);
  }
  return STAGE_WAIT[task.stage];
}
