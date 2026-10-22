import type { CommandOf } from '../commands/index.ts';
import { isTaskSettled, type PullRequest, type Task } from '../model/index.ts';
import { resolvePullRequestFixPrompt } from '../prompts/index.ts';
import { listActiveRuns, listOpenBlockers } from '../state/queries.ts';
import { type Decider, quoteTitles } from './decider.ts';
import { startFix } from './fixes.ts';
import { settleTask } from './lifecycle.ts';

function isMergeReady(pullRequest: PullRequest) {
  return (
    pullRequest.state === 'open' &&
    (pullRequest.checks === 'passing' || pullRequest.checks === 'none') &&
    pullRequest.unresolvedComments === 0 &&
    pullRequest.mergeable === true
  );
}

function needsPullRequestFix(pullRequest: PullRequest) {
  return (
    pullRequest.state === 'open' &&
    (pullRequest.checks === 'failing' ||
      pullRequest.unresolvedComments > 0 ||
      pullRequest.mergeable === false)
  );
}

function isShipping(task: Task) {
  return task.stage === 'shipping' || task.stage === 'awaiting_merge';
}

function hasMergeGate(decider: Decider, taskId: string) {
  return decider.hasOpenGate(taskId, (gate) => gate.kind === 'merge');
}

function isMerging(decider: Decider, task: Task) {
  return task.stage === 'awaiting_merge' && !hasMergeGate(decider, task.id);
}

function holdForBlockers(decider: Decider, task: Task) {
  const blockers = listOpenBlockers(decider.state, task);
  if (blockers.length === 0) return false;
  decider.withdrawGates(task.id, (gate) => gate.kind === 'merge');
  decider.stage(task.id, 'shipping', `waiting for ${quoteTitles(blockers)} to merge`);
  return true;
}

function openMergeGate(decider: Decider, task: Task) {
  if (holdForBlockers(decider, task) || hasMergeGate(decider, task.id)) return;
  decider.progressed(task.id);
  decider.withdrawGates(task.id, (gate) => gate.purpose === 'failure');
  decider.stage(task.id, 'awaiting_merge', 'pull request is clean');
  decider.openGate(task.id, 'merge', 'decision', task.title, task.summary ?? '');
}

export function requestPush(decider: Decider, taskId: string) {
  const task = decider.task(taskId);
  decider.emit({ type: 'pull_request.push_requested', taskId });
  decider.run({ kind: task.pullRequest ? 'pull_request.push' : 'pull_request.open', taskId });
}

export function recheckPullRequest(decider: Decider, taskId: string) {
  decider.withdrawGates(taskId, (gate) => gate.kind === 'merge');
  decider.stage(taskId, 'shipping', 'checking the pull request');
  decider.run({ kind: 'pull_request.watch', taskId });
}

export function reviewMergeHold(decider: Decider, taskId: string) {
  const task = decider.task(taskId);
  if (!isShipping(task) || isMerging(decider, task)) return;
  holdForBlockers(decider, task);
  decider.run({ kind: 'pull_request.watch', taskId });
}

function reactToPullRequest(decider: Decider, taskId: string, pullRequest: PullRequest) {
  if (pullRequest.state === 'merged') {
    settleTask(decider, taskId, 'merged', 'pull request merged');
    return;
  }
  if (pullRequest.state === 'closed') {
    settleTask(decider, taskId, 'cancelled', 'pull request closed');
    return;
  }
  const task = decider.task(taskId);
  if (!isShipping(task) || task.pushPending || isMerging(decider, task)) return;
  if (listActiveRuns(decider.state, taskId).length > 0) return;
  if (task.pushedSha && pullRequest.headSha && pullRequest.headSha !== task.pushedSha) {
    decider.withdrawGates(taskId, (gate) => gate.kind === 'merge');
    decider.stage(taskId, 'shipping', 'waiting for GitHub to see the push');
    return;
  }
  if (isMergeReady(pullRequest)) {
    openMergeGate(decider, task);
    return;
  }
  decider.withdrawGates(taskId, (gate) => gate.kind === 'merge');
  if (!needsPullRequestFix(pullRequest)) {
    decider.stage(taskId, 'shipping', 'waiting for CI');
    return;
  }
  startFix(
    decider,
    taskId,
    'pull_request',
    resolvePullRequestFixPrompt(pullRequest),
    `${pullRequest.checks}:${pullRequest.unresolvedComments}:${pullRequest.mergeable}`
  );
}

export function recordPullRequest(decider: Decider, command: CommandOf<'pull_request.record'>) {
  const task = decider.task(command.taskId);
  if (isTaskSettled(task)) return;
  decider.emit({
    type: task.pullRequest ? 'pull_request.updated' : 'pull_request.opened',
    taskId: task.id,
    pullRequest: command.pullRequest,
  });
  reactToPullRequest(decider, task.id, command.pullRequest);
}

export function recordPush(decider: Decider, command: CommandOf<'pull_request.pushed'>) {
  if (isTaskSettled(decider.task(command.taskId))) return;
  decider.emit({ type: 'pull_request.pushed', taskId: command.taskId, sha: command.sha });
}
