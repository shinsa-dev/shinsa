import type { CommandOf } from '../commands/index.ts';
import {
  hasStep,
  isTaskSettled,
  type MergeQueueEntry,
  type MergeQueueState,
  type PullRequest,
  type PullRequestWatch,
  type PullRequestWatchChange,
  type PushHookFailure,
  resolveCurrentRound,
  resolveTaskRounds,
  type ShippingStep,
  type ShippingStepKind,
  type Task,
} from '../domain/index.ts';
import {
  resolveCodeFence,
  resolvePullRequestFixPrompt,
  resolvePushHookFixPrompt,
  resolveUpdateConflictFixPrompt,
} from '../prompts/index.ts';
import { describeRetryDelay } from '../state/activity.ts';
import { listActiveRuns, listOpenBlockers, resolveTaskWorkspace } from '../state/queries.ts';
import { askToUpdateWorkspace, isAwaitingWorkspaceUpdate, startHeldConflictFix } from './conflicts.ts';
import { type Decider, quoteTitles } from './decider.ts';
import { applyEditsApproval } from './edits.ts';
import { resetFixBudget, startFix } from './fixes.ts';
import { settleTask } from './lifecycle.ts';
import { recordEarlierRoundMerged } from './rounds.ts';
import { finishMerge } from './shapes.ts';
import {
  createPullRequestWatch,
  evaluatePullRequestWatch,
  hasFixableChange,
  isSamePullRequest,
  isSamePullRequestWatch,
  PULL_REQUEST_READ_FAILURE_LIMIT,
  resolvePullRequestSignature,
  trimWatchChanges,
} from './watch.ts';

const MERGE_QUEUE_REASON: Record<MergeQueueState, string> = {
  queued: 'waiting in GitHub’s merge queue',
  awaiting_checks: 'in GitHub’s merge queue, waiting for its checks',
  mergeable: 'in GitHub’s merge queue, about to merge',
  unmergeable: 'in GitHub’s merge queue, which cannot merge it',
  locked: 'in GitHub’s merge queue, merging',
  auto_merge: 'waiting for GitHub to merge it automatically',
};

type MergingOutcome = 'merging' | 'queued' | 'removed';

const RETRYING_STEP: Record<ShippingStepKind, string> = {
  updating: 'updating the branch',
  pushing: 'pushing',
  opening: 'opening the pull request',
};

const HOOK_RUNNING = ' (the repository’s pre-push hook is running)';

const HOOK_FAILED_AGAIN = 'the pre-push hook failed again';

const UNREADABLE_HOOK_FAILURE = 'unreadable';

const GATE_OUTPUT_LINES = 40;

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
  return decider.hasOpenGate(taskId, (gate) => gate.type === 'merge');
}

function isMerging(decider: Decider, task: Task) {
  return task.stage === 'awaiting_merge' && !hasMergeGate(decider, task.id);
}

function holdForBlockers(decider: Decider, task: Task) {
  const blockers = listOpenBlockers(decider.state, task);
  if (blockers.length === 0) return false;
  decider.withdrawGates(task.id, (gate) => gate.type === 'merge');
  decider.stage(task.id, 'shipping', `waiting for ${quoteTitles(blockers)} to merge`);
  return true;
}

function describeQueueEntry(entry: MergeQueueEntry) {
  const reason = MERGE_QUEUE_REASON[entry.state];
  return entry.position === null ? reason : `${reason} (position ${entry.position})`;
}

function describeQueueRemoval(previous: MergeQueueEntry, pullRequest: PullRequest) {
  if (previous.state === 'auto_merge')
    return 'GitHub turned off automatic merging before it merged the pull request.';
  const reason = pullRequest.queueRemoval ? `: ${pullRequest.queueRemoval}` : '';
  return `GitHub’s merge queue took the pull request out without merging it${reason}.`;
}

function openMergeGate(decider: Decider, task: Task, removal: string | null) {
  if (holdForBlockers(decider, task) || hasMergeGate(decider, task.id)) return;
  if (startHeldConflictFix(decider, task.id)) return;
  decider.progressed(task.id);
  decider.withdrawGates(task.id, (gate) => gate.type === 'failure');
  if (applyEditsApproval(decider, task.id, 'merge')) {
    startMerge(decider, task.id);
    return;
  }
  decider.stage(
    task.id,
    'awaiting_merge',
    removal ? 'removed from the merge queue' : 'pull request is clean'
  );
  const body = [removal, task.summary].filter(Boolean).join('\n\n');
  decider.openGate(task.id, 'merge', task.title, body);
}

function recordWatch(
  decider: Decider,
  taskId: string,
  next: PullRequestWatch,
  changes: PullRequestWatchChange[]
) {
  const current = decider.task(taskId).pullRequestWatch;
  if (current && changes.length === 0 && isSamePullRequestWatch(current, next)) return;
  decider.emit({ type: 'pull_request.watched', taskId, watch: next, changes: trimWatchChanges(changes) });
}

function clearReadFailures(decider: Decider, taskId: string) {
  if ((decider.task(taskId).pullRequestReadFailures ?? 0) === 0) return;
  decider.emit({ type: 'pull_request.read_failures_cleared', taskId });
}

function restartWatch(decider: Decider, taskId: string) {
  clearReadFailures(decider, taskId);
  const watch = decider.task(taskId).pullRequestWatch;
  if (!watch?.stopped) return;
  recordWatch(decider, taskId, { ...watch, stopped: null, wakes: 0 }, []);
}

export function requestPush(decider: Decider, taskId: string) {
  const task = decider.task(taskId);
  restartWatch(decider, taskId);
  decider.emit({ type: 'pull_request.push_requested', taskId });
  decider.run({ kind: task.pullRequest ? 'pull_request.push' : 'pull_request.open', taskId });
}

export function shipReviewedWork(decider: Decider, taskId: string) {
  const reason = decider.task(taskId).pullRequest ? 'pushing the changes' : 'opening the pull request';
  decider.stage(taskId, 'shipping', reason);
  requestPush(decider, taskId);
}

export function startMerge(decider: Decider, taskId: string) {
  decider.stage(taskId, 'awaiting_merge', 'merging');
  decider.run({ kind: 'pull_request.merge', taskId });
}

export function recheckPullRequest(decider: Decider, taskId: string) {
  restartWatch(decider, taskId);
  decider.withdrawGates(taskId, (gate) => gate.type === 'merge');
  decider.stage(taskId, 'shipping', 'checking the pull request');
  decider.run({ kind: 'pull_request.watch', taskId });
}

export function reviewMergeHold(decider: Decider, taskId: string) {
  const task = decider.task(taskId);
  if (!isShipping(task) || isMerging(decider, task)) return;
  holdForBlockers(decider, task);
  decider.run({ kind: 'pull_request.watch', taskId });
}

function reactWhileMerging(
  decider: Decider,
  task: Task,
  pullRequest: PullRequest,
  previous: PullRequest | null
): { outcome: MergingOutcome; removal: string | null } {
  const entry = pullRequest.mergeQueue ?? null;
  if (entry) {
    decider.stage(task.id, 'awaiting_merge', describeQueueEntry(entry));
    return { outcome: 'queued', removal: null };
  }
  const queued = previous?.mergeQueue ?? null;
  if (!queued) return { outcome: 'merging', removal: null };
  decider.stage(task.id, 'shipping', 'removed from the merge queue');
  return { outcome: 'removed', removal: describeQueueRemoval(queued, pullRequest) };
}

function reactToPullRequest(
  decider: Decider,
  command: CommandOf<'pull_request.record'>,
  previous: PullRequest | null
) {
  const { taskId, pullRequest } = command;
  if (pullRequest.state === 'merged') {
    finishMerge(decider, taskId);
    return;
  }
  if (pullRequest.state === 'closed') {
    settleTask(decider, taskId, 'cancelled', 'pull request closed');
    return;
  }
  const task = decider.task(taskId);
  if (!isShipping(task) || task.pushPending) return;
  let removal: string | null = null;
  if (isMerging(decider, task)) {
    const merging = reactWhileMerging(decider, task, pullRequest, previous);
    if (merging.outcome !== 'removed') return;
    removal = merging.removal;
  }
  if (listActiveRuns(decider.state, taskId).length > 0) return;
  if (task.pushedSha && pullRequest.headSha && pullRequest.headSha !== task.pushedSha) {
    decider.withdrawGates(taskId, (gate) => gate.type === 'merge');
    if (pullRequest.headSha === task.pushedFrom) {
      decider.stage(taskId, 'shipping', 'waiting for GitHub to see the push');
      return;
    }
    decider.emit({ type: 'pull_request.head_moved', taskId, sha: pullRequest.headSha });
  }
  reactToWatch(decider, decider.task(taskId), command, removal);
}

function reactToWatch(
  decider: Decider,
  task: Task,
  command: CommandOf<'pull_request.record'>,
  removal: string | null
) {
  const { pullRequest } = command;
  const watch = task.pullRequestWatch ?? createPullRequestWatch(decider.context.now);
  const report = evaluatePullRequestWatch(
    watch,
    pullRequest,
    command.remarks ?? null,
    command.viewer ?? null
  );
  const fresh = report.changes.some((change) => change.kind === 'remarks');
  if (isMergeReady(pullRequest) && !fresh) {
    const wakes = watch.stopped ? 0 : report.next.wakes;
    recordWatch(decider, task.id, { ...report.next, stopped: null, wakes }, report.changes);
    openMergeGate(decider, decider.task(task.id), removal);
    return;
  }
  if (watch.stopped || isAwaitingWorkspaceUpdate(decider, task)) return;
  decider.withdrawGates(task.id, (gate) => gate.type === 'merge');
  if (report.exhausted) {
    recordWatch(decider, task.id, { ...report.next, stopped: 'comment_limit' }, report.changes);
    decider.fail(
      task.id,
      'Stopped watching the pull request',
      `Shinsa stopped watching pull request #${pullRequest.number} after ${report.next.wakes} updates in a row that brought only new comments. Read them on GitHub, then retry to watch it again.`
    );
    return;
  }
  recordWatch(decider, task.id, report.next, report.changes);
  if (!hasFixableChange(report.changes) && !needsPullRequestFix(pullRequest)) {
    decider.stage(task.id, 'shipping', 'waiting for CI');
    return;
  }
  if (pullRequest.mergeable === false && resolveTaskWorkspace(decider.state, task) === 'gitbutler') {
    askToUpdateWorkspace(decider, task, pullRequest);
    return;
  }
  startFix(
    decider,
    task.id,
    'pull_request',
    resolvePullRequestFixPrompt(pullRequest, trimWatchChanges(report.changes), removal),
    resolvePullRequestSignature(pullRequest, report.next)
  );
}

function isEarlierRoundPullRequest(task: Task, number: number) {
  if (task.pullRequest?.number === number) return false;
  const current = resolveCurrentRound(task).number;
  return resolveTaskRounds(task).some(
    (round) => round.number !== current && round.pullRequest?.number === number
  );
}

export function recordPullRequest(decider: Decider, command: CommandOf<'pull_request.record'>) {
  const task = decider.task(command.taskId);
  if (isTaskSettled(task) || !hasStep(task, 'pull_request')) return;
  if (task.pullRequest?.state === 'merged') return;
  if (isEarlierRoundPullRequest(task, command.pullRequest.number)) return;
  if (recordEarlierRoundMerged(decider, task, command.pullRequest)) return;
  const previous = task.pullRequest;
  clearReadFailures(decider, task.id);
  if (!isSamePullRequest(previous, command.pullRequest)) {
    decider.emit({
      type: previous ? 'pull_request.updated' : 'pull_request.opened',
      taskId: task.id,
      pullRequest: command.pullRequest,
    });
  }
  reactToPullRequest(decider, command, previous);
}

export function recordPullRequestReadFailure(
  decider: Decider,
  command: CommandOf<'pull_request.read_failed'>
) {
  const task = decider.task(command.taskId);
  if (isTaskSettled(task) || !task.pullRequest) return;
  const watch = task.pullRequestWatch ?? createPullRequestWatch(decider.context.now);
  if (watch.stopped) return;
  const failures = Math.min((task.pullRequestReadFailures ?? 0) + 1, PULL_REQUEST_READ_FAILURE_LIMIT);
  if (failures !== task.pullRequestReadFailures) {
    decider.emit({ type: 'pull_request.read_failed', taskId: task.id, failures, detail: command.detail });
  }
  if (failures < PULL_REQUEST_READ_FAILURE_LIMIT || !isShipping(task)) return;
  if (hasMergeGate(decider, task.id) || listActiveRuns(decider.state, task.id).length > 0) return;
  recordWatch(decider, task.id, { ...watch, stopped: 'unreadable' }, []);
  decider.fail(
    task.id,
    'Could not read the pull request',
    `Shinsa failed to read pull request #${task.pullRequest.number} from GitHub ${failures} times in a row: ${command.detail} Check it on GitHub, then retry to watch it again.`
  );
}

export function recordPush(decider: Decider, command: CommandOf<'pull_request.record_push'>) {
  const task = decider.task(command.taskId);
  if (isTaskSettled(task) || (task.pushedSha === command.sha && !task.pushPending)) return;
  decider.emit({ type: 'pull_request.pushed', taskId: command.taskId, sha: command.sha });
}

function isShippingNow(decider: Decider, task: Task) {
  if (task.stage !== 'shipping' || decider.hasOpenGate(task.id, (gate) => gate.type === 'failure'))
    return false;
  return task.pushPending === true || task.pullRequest === null;
}

function describeShippingStep(task: Task, step: ShippingStep) {
  switch (step.kind) {
    case 'updating':
      return `updating the branch onto ${step.base}`;
    case 'pushing': {
      const what = task.pullRequest ? 'pushing the changes' : 'pushing the branch';
      return step.hook ? `${what}${HOOK_RUNNING}` : what;
    }
    case 'opening':
      return 'opening the pull request';
  }
}

export function recordShippingStep(decider: Decider, command: CommandOf<'pull_request.record_step'>) {
  const task = decider.task(command.taskId);
  if (!isShippingNow(decider, task)) return;
  decider.stage(task.id, 'shipping', describeShippingStep(task, command.step));
}

export function recordPushRetry(decider: Decider, command: CommandOf<'pull_request.record_retry'>) {
  const task = decider.task(command.taskId);
  if (!isShippingNow(decider, task)) return;
  const { step, attempt, attempts, retryAt, detail } = command;
  decider.emit({
    type: 'pull_request.push_retrying',
    taskId: task.id,
    step,
    attempt,
    attempts,
    retryAt,
    detail,
  });
  const delay = describeRetryDelay(retryAt, decider.context.now);
  decider.stage(
    task.id,
    'shipping',
    `${RETRYING_STEP[step]} again in ${delay}, attempt ${attempt + 1} of ${attempts}: ${detail}`
  );
}

export function recordUpdateConflict(
  decider: Decider,
  command: CommandOf<'pull_request.record_update_conflict'>
) {
  const task = decider.task(command.taskId);
  if (!isShippingNow(decider, task) || !task.pushPending) return;
  const files = [...new Set(command.files)].sort();
  startFix(
    decider,
    task.id,
    'update',
    resolveUpdateConflictFixPrompt(command.base, files),
    `update:${command.base}:${files.join('\n')}`
  );
}

function resolveHookSignature(failures: readonly string[] | null) {
  if (!failures || failures.length === 0) return UNREADABLE_HOOK_FAILURE;
  return [...new Set(failures)].sort().join('\n');
}

function startHookFix(
  decider: Decider,
  taskId: string,
  failure: PushHookFailure | null | undefined,
  guidance: string | null
) {
  startFix(
    decider,
    taskId,
    'hook',
    resolvePushHookFixPrompt(failure?.output ?? '', failure?.failures ?? null, guidance),
    `hook:${failure?.signature ?? UNREADABLE_HOOK_FAILURE}`
  );
}

function describeHookGate(failure: PushHookFailure) {
  const tail = failure.output.split('\n').slice(-GATE_OUTPUT_LINES).join('\n');
  const fence = resolveCodeFence(tail);
  const named = failure.failures ?? [];
  return [
    'The repository’s pre-push hook rejected the push again after a fix round, with the same failures, so Shinsa stopped.',
    ...(named.length > 0 ? ['', ...named.map((name) => `- ${name}`)] : []),
    '',
    `${fence}\n${tail}\n${fence}`,
    '',
    'Send it to the agent again for another fix round, or cancel the task. Shinsa never pushes without the hook.',
  ].join('\n');
}

export function recordHookFailure(decider: Decider, command: CommandOf<'pull_request.record_hook_failure'>) {
  const task = decider.task(command.taskId);
  if (!isShippingNow(decider, task) || !task.pushPending) return;
  const failure: PushHookFailure = {
    output: command.output,
    failures: command.failures,
    signature: resolveHookSignature(command.failures),
  };
  const repeated = task.pushHookFailure?.signature === failure.signature;
  decider.emit({ type: 'pull_request.hook_failed', taskId: task.id, failure });
  if (!repeated) {
    startHookFix(decider, task.id, failure, null);
    return;
  }
  decider.stage(task.id, 'shipping', HOOK_FAILED_AGAIN);
  decider.fail(task.id, 'The pre-push hook failed again', describeHookGate(failure), null, 'push_hook');
}

export function retryHookFix(decider: Decider, taskId: string, guidance: string | null) {
  resetFixBudget(decider, taskId);
  startHookFix(decider, taskId, decider.task(taskId).pushHookFailure, guidance);
}
